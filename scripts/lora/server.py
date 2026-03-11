import argparse
import copy
import gc
import glob
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Union

import coreferee
import pandas as pd
import peft
import PyPDF2
import pytorch_lightning as pl
import spacy
import torch
import transformers
import transformers.utils as utils
import transformers.utils.import_utils as import_utils
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from peft import PeftModel
from sentence_transformers import util
from spacy.language import Language
from torch.utils.data import Dataset
from tqdm import tqdm
from transformers import AutoModel, AutoTokenizer, T5ForConditionalGeneration, T5Tokenizer


@dataclass(frozen=True)
class AppConfig:
    project_root: Path
    input_dir: Path
    output_dir: Path
    model_dir: Path
    templates_csv: Path

    @classmethod
    def from_project_root(cls, project_root: Union[str, Path]) -> "AppConfig":
        root = Path(project_root).resolve()
        return cls(
            project_root=root,
            input_dir=root / "inputs" / "euai",
            output_dir=root / "outputs" / "euai",
            model_dir=root / "model" / "final_lora_model",
            templates_csv=root / "CLaROv2.csv",
        )


app = FastAPI()
APP_CONFIG = AppConfig.from_project_root(os.getcwd())
QUESTION_TOKENIZER = None
QUESTION_MODEL = None
SEMANTIC_TOKENIZER = None
SEMANTIC_MODEL = None

if not hasattr(transformers, 'is_torch_npu_available'):
    transformers.is_torch_npu_available = lambda: False

if not hasattr(utils, 'is_torch_npu_available'):
    utils.is_torch_npu_available = lambda: False

missing_functions = {
    'is_torch_npu_available': lambda: False,
    'is_torch_mps_available': lambda: False,
    'is_torch_xpu_available': lambda: False,
    'is_torch_tpu_available': lambda: False,
    'is_nltk_available': lambda: False,
    'is_torch_neuroncore_available': lambda: False,
    'is_torch_fx_available': lambda: False,
}

for func_name, func in missing_functions.items():
    if not hasattr(import_utils, func_name):
        setattr(import_utils, func_name, func)
    if not hasattr(transformers, func_name):
        setattr(transformers, func_name, func)

if not hasattr(import_utils, 'NLTK_IMPORT_ERROR'):
    import_utils.NLTK_IMPORT_ERROR = "NLTK not available"
    print("Added NLTK_IMPORT_ERROR")

if not hasattr(import_utils, 'is_nltk_available'):
    import_utils.is_nltk_available = lambda: False
    print("Added is_nltk_available")

nlp = spacy.load("en_core_web_sm", disable=["ner", "lemmatizer"])
nlp.add_pipe("coreferee")
print(f"PEFT version: {peft.__version__}")

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
pl.seed_everything(42)


def load_runtime_models(config: AppConfig):
    global QUESTION_TOKENIZER, QUESTION_MODEL, SEMANTIC_TOKENIZER, SEMANTIC_MODEL

    if QUESTION_TOKENIZER is None or QUESTION_MODEL is None:
        trained_model_path = str(config.model_dir)
        QUESTION_TOKENIZER = T5Tokenizer.from_pretrained(trained_model_path, local_files_only=True)
        base_model = T5ForConditionalGeneration.from_pretrained("t5-base")
        QUESTION_MODEL = PeftModel.from_pretrained(base_model, trained_model_path)
        QUESTION_MODEL = QUESTION_MODEL.to(device)
        QUESTION_MODEL.eval()

    if SEMANTIC_TOKENIZER is None or SEMANTIC_MODEL is None:
        model_id = "sentence-transformers/all-MiniLM-L6-v2"
        SEMANTIC_TOKENIZER = AutoTokenizer.from_pretrained(model_id)
        SEMANTIC_MODEL = AutoModel.from_pretrained(model_id).to(device)
        SEMANTIC_MODEL.eval()

#########################################
# Input text preparation
#########################################
def extract_pdf(pdf_path):
    print("pdf_path:", pdf_path)
    text = ""
    try:
        reader = PyPDF2.PdfReader(pdf_path)
        num_pages = len(reader.pages)
        print("Number of pages",num_pages)
        for page_num in range(num_pages):
            page = reader.pages[page_num]
            text += page.extract_text()
    except Exception as e:
        print(f"Error reading {pdf_path}: {e}")
    return text

@Language.component("fix_sentences")
def fixed_chunk_sents(doc, chunk_size=50000):
    nlp.max_length = min(chunk_size + 10000, 2000000)
    nlp.disable_pipes(["parser", "ner"])
    sent_size=25
    if len(doc):
        doc[0].is_sent_start = True
    for i in range(chunk_size, len(doc), chunk_size):
        print("sentence size:",len(i))
        doc[i].is_sent_start = True
    for sent_idx, sent in enumerate(doc.sents):
            sent_text = sent.text.strip()
            # Skip very short sentences
            if len(sent_text) < 20:
                continue
    return doc

def extract_sentences(file, chunk_size=50000):
    
    if not isinstance(file, str):
        if isinstance(file, (list, tuple)):
            file = "\n".join(map(str, file))
        elif hasattr(file, "tolist"):  # e.g., pandas Series
            file = "\n".join(map(str, file.tolist()))
        else:
            file = str(file)
    nlp.max_length = max(nlp.max_length, min(chunk_size + 10000, 2000000))
    nlp_sent = spacy.blank("en")
    nlp_sent.add_pipe("sentencizer")
    if "sentencizer" not in nlp.pipe_names:
        nlp.add_pipe("sentencizer", first=True)

    all_sentences = []
    with nlp.select_pipes(disable=["parser", "ner"]):
        for i in range(0, len(file), chunk_size):
            doc = nlp_sent(file[i:i+chunk_size])
            sentences = [x.text for x in doc.sents]
            all_sentences.extend(sentences)
            del doc
            gc.collect()
    print("all_sentences size:", len(all_sentences))
    return all_sentences

def readTextFile(base_path, text_path=None):   
    # pattern = os.path.join(base_path, "**", "*.txt")
    pattern = os.path.join(base_path, "*.txt")
    txt_files = glob.glob(pattern, recursive=True)
        
    document_patterns = [
        re.compile(r'IW-CDS-\d+-\d+\s*\([^)]+\)'),
        re.compile(r'^\s*\d+\s*$'),
    ]
    section_pattern = re.compile(r'\bnSection\s+\d+(?:\.\d+)*\b')
    subsection_pattern = re.compile(r'\bnSub-section\s+\d+(?:\.\d+)*\b')
    header_footer_pattern = re.compile(r'IW-CDS-\d+-\d+.*Revision.*\d{4}')
    unwanted_patterns = document_patterns + [
                                section_pattern,
                                subsection_pattern,
                                header_footer_pattern
                                ]
    print(f"Found {len(txt_files)} .txt files in {base_path}")
    outText = []
    for file_path in txt_files:
        print(f"Reading: {file_path}")
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()  
                outText.append({'content': content})
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            
    sentText= extract_sentences(outText)
    # df =pd.DataFrame({'sentences': sentText[0]})
    df = pd.DataFrame({'sentences': sentText})
    print(type(sentText), len(sentText))
    print(type(sentText[0]))
    print(df.head(10))
    for i in range(0, len(df)):
        df.at[i, 'sentences_new'] = re.sub(r'\b(\d+\w{1,2})\b'," ",str(df.loc[i,'sentences']))
        df.at[i, 'sentences_new'] = re.sub(r'[\d+]'," ",str(df.loc[i,'sentences_new']))
        df.at[i, 'sentences_new'] = re.sub(r'[^\w\s]'," ",str(df.loc[i,'sentences_new']))
        df.at[i, 'sentences_new'] = re.sub(r'\b\w{1}\b'," ",str(df.loc[i,'sentences_new']))
        df.at[i, 'sentences_new'] = re.sub("[\(%\[].*?[\)\n]]"," ",str(df.loc[i,'sentences_new']))
        df.at[i, 'sentences_new'] = str(df.at[i, 'sentences_new']).replace('\n', '\n ').strip('\n')
        df.at[i, 'sentences_new'] = str(df.at[i, 'sentences_new']).replace('\n', '')
    df['sentences_new'] = df['sentences_new'].str.replace(r"\s*https?:'//\S+(\s+|$)", " ").str.strip()
    df['sentences_new'] = df['sentences_new'].str.replace(r"ufeff", " ").str.strip()
    df['text'] = df['sentences_new'].str.replace(r"\s*https?:'//\S+(\s+|$)", " ").str.strip()
    df.at[i, 'text'] = str(df.at[i, 'text']).replace('\n', '\n ')
    df['text2'] = df['text'].str.replace(r"ufeff", " ").str.strip()
    current_length =len(df)
    bad_mask = df['text2'].apply(lambda x: any(p.search(x) for p in unwanted_patterns))
    mask = df['text2'].fillna('').astype(str).str.split().str.len() > 10
    df = df[~bad_mask].reset_index(drop=True)
    df = df[mask].reset_index(drop=True)
    print("Dropped rows of unsable sentences:", current_length - len(df))
    df2= df[["text2"]]
    df2 = df2.rename(columns={"text2":"sentences_new"})
    df2["sentences_new"] = df2["sentences_new"].str.replace(r'(?:(?<=\s)|^)n(?=[A-Za-z])', '', regex=True)
    df2["sentences_new"] = df2["sentences_new"].str.replace(r'\\n', ' ', regex=True)
    df2["sentences_new"] = (
    df2["sentences_new"]
      .astype(str)
      .str.replace(r"\s+", " ", regex=True)
      .str.strip()
        )
  
    if text_path is None:
        text_path = os.getcwd() + '/outputs/euai/cleaned_text.csv'
    df2.to_csv(text_path, index = False)
    return df2

# QuestionGenerationDataset - Add proper T5 task prefix
class QuestionGenerationDataset(Dataset):
    def __init__(self, tokenizer, filepath, max_len_inp=256, max_len_out=64):
        self.path = filepath
        self.passage_column = "context"
        self.question = "question"
        self.data = pd.read_csv(self.path, nrows=15000)
        self.max_len_input = max_len_inp
        self.max_len_output = max_len_out
        self.tokenizer = tokenizer
        self.inputs = []
        self.targets = []
        self.skippedcount = 0
        self._build()
    
    def __len__(self):
        return len(self.inputs)
    
    def __getitem__(self, index):
        source_ids = self.inputs[index]["input_ids"].squeeze()
        target_ids = self.targets[index]["input_ids"].squeeze()
        src_mask = self.inputs[index]["attention_mask"].squeeze()  
        target_mask = self.targets[index]["attention_mask"].squeeze()  
        labels = copy.deepcopy(target_ids)
        labels[labels == 0] = -100
        return {"source_ids": source_ids, "source_mask": src_mask, 
                "target_ids": target_ids, "target_mask": target_mask, "labels": labels}
    
    def _build(self):
        for idx in tqdm(range(len(self.data))):
            passage = self.data.loc[idx, self.passage_column]
            question = self.data.loc[idx, self.question]
            
            #  FIX: Use proper T5 task prefix for question generation
            input_ = f"generate question: context: {str(passage)}"  
            target = str(question)
            
            # Check length
            test_input_encoding = self.tokenizer(
                input_,
                truncation=False,
                return_tensors="pt"
            )
            length_of_input_encoding = len(test_input_encoding['input_ids'][0])
            
            if length_of_input_encoding > self.max_len_input:
                self.skippedcount = self.skippedcount + 1
                continue
            
            # Tokenize inputs 
            tokenized_inputs = self.tokenizer(
                input_, 
                max_length=self.max_len_input, 
                padding='max_length', 
                truncation=True, 
                return_tensors="pt"
            )
            
            # Tokenize targets with target tokenizer
            with self.tokenizer.as_target_tokenizer():
                tokenized_targets = self.tokenizer(
                    target, 
                    max_length=self.max_len_output, 
                    padding='max_length', 
                    truncation=True,
                    return_tensors="pt"
                )
            
            self.inputs.append(tokenized_inputs)
            self.targets.append(tokenized_targets)
        
        print(f"Dataset built: {len(self.inputs)} samples, skipped {self.skippedcount}")

#########################################
# Functions for CQ generation
#########################################

# Generate CQs function - Fixed the logic and tensor handling
def generate(df2, model, tokenizer, device="cpu", path=None):
    """Generate questions from sentences"""
    
    model.eval()
    model.to(device)
    print("df2:", type(df2))
    sentences = df2['sentences_new'].tolist()
    
    # Ensure it's a list
    if isinstance(sentences, str):
        sentences = [sentences]
    elif not isinstance(sentences, list):
        sentences = [str(sentences)]
    print("sentences:", type(sentences))
    all_questions = []
    
    # Process each sentence
    for sentence in sentences:
        # Format input for T5 (same as training format)
        formatted_input = f"ask a question: context: {sentence}"
        
        # Tokenize
        encoding = tokenizer(
            formatted_input,
            return_tensors="pt",
            max_length=256,
            truncation=True,
            padding=True
        ).to(device)
        
        input_ids = encoding["input_ids"]
        attention_mask = encoding["attention_mask"]
        
        # Generate
        with torch.no_grad():
            outputs = model.generate(
                input_ids=input_ids,
                attention_mask=attention_mask,
                max_length=64,
                min_length=8,
                num_beams=5,
                num_return_sequences=1,  # Generate 3 questions per sentence
                early_stopping=True,
                no_repeat_ngram_size=3,
                length_penalty=1.0
                # temperature=0.9
            )
        
        # Decode outputs
        for output in outputs:
            question = tokenizer.decode(output, skip_special_tokens=True, clean_up_tokenization_spaces=True)
            
            # Clean the output
            question = question.strip()
            
            # Only add if it looks like a question
            if question.lower().startswith(('what', 'why', 'how', 'when', 'where', 'who', 'which')):
                question += '?'
                all_questions.append({
                    'source': sentence,
                    'question': question
                })
   
    if path is None:
        path = os.getcwd() + "/outputs/euai/CQs.csv"
    df = pd.DataFrame(all_questions)
    df.to_csv(path, index=False, encoding='utf-8')
    return path

#########################################
# Functions for CQ post-processing
#########################################
    
# Post processing of generated questions
def postprocess(path, cq_path=None):
    dcqs= pd.read_csv(path, encoding='utf-8')
    dcqs.to_dict('records')
    print("loaded file", dcqs.head())
    # dcqs =pd.DataFrame(questions,columns = ['source', 'question'])
    dcqs = dcqs.rename(columns = {'question':'CQs'})
    dcqs['CQs'] = dcqs['CQs'].map(lambda x: x.replace("question", '').replace(":", '').replace("'", '').replace('[', '').replace(']', '').replace('"', ''))
  
    if cq_path is None:
        cq_path = os.getcwd() + "/outputs/euai/cq_output.txt"
    for i in range(0, len(dcqs)):
        dcqs.at[i, 'newCQs'] =re.sub(r"\s\([A-Z][a-z]+,\s[A-Z][a-z]?\.[^\)]*,\s\d{4}\)","",str(dcqs.loc[i,'CQs']))
    with open(cq_path, "w") as f:
        f.write("\n".join(dcqs["newCQs"]))
    return cq_path

# Abstract pattern extraction
class AbstractPattern:
    def mark_chunk(self, cq, spans, chunktype, offset, counter):
        for (start, end) in spans:  # for each span of EC/PC candidate
            cq = cq[:start - offset] + chunktype + str(counter) +\
                cq[end - offset:]  # substitute that candidate with EC/PC marker
            offset += (end - start) - len(chunktype) - 1  # check by how much the total length of CQ changed
        return cq, offset

    def extract_EC_chunks(self, cq):
        """
            Find EC chunks and replace their occurences with EC tags
        """

        def _get_EC_span_reject_wh_starters(chunk):
            """
                By default, SpaCy treats question words (wh- pronouns starting questions: where, what,...)
                as nouns, so often if questions starts with wh- pronoun + noun (like: What software is the best?)
                the whole "what software" is interpreted as EC chunk - this function tries to fix that issue by
                omitting wh- word if EC candidate consists of multiple tokens, and first token in question is wh- word.
                The same issue occurs for "How" starter.
                Moreover, chunks extracted with SpaCy enclose words like 'any', 'some' which are important for us, so
                they shouldn't be substituted with 'EC' marker. Thus we remove such words if they prepend the EC.
                The result is returned as the span - the position of beginning of the fixed EC and position of end.
            """
            if (len(chunk) > 1 and
                    (chunk[0].text.lower().startswith("wh")) or
                    (chunk[0].text.lower() == 'how')):
                chunk = chunk[1:]

            if chunk[0].text.lower() in ['any', 'some', 'many', 'well', 'its']:
                chunk = chunk[1:]

            return (chunk.start_char, chunk.end_char)

        doc = nlp(cq)

        #  thins classified as ECs which shouldn't be interpreted that way
        rejecting_ec = ["what", "which", "when", "where", "who", "type", "types",
                        "kinds", "kind", "category", "categories", "difference",
                        "differences", "extent", "i", "we", "respect", "there",
                        "not", "the main types", "the possible types", "the types",
                        "the difference", "the differences", "the main categories"]

        counter = 1  # counter indicating current chunk id (EC1, EC2, ...)
        offset = 0   # if we replace for example "Weka" with 'EC1' then the new CQ will be shorter by one char the offset remembers by how much we have shortened the current CQ with EC markers, so the new substitutions can be applied in correct places.


        # we decided to treat qualities defined as adjectives in: How + Quality(adjective) + Verb as EC
        if (doc[0].text.lower() == 'how' and
                doc[1].pos_ == 'ADJ' and
                doc[2].pos_ == 'VERB'):

            start = doc[1].idx  # mark where quality starts
            end = start + len(doc[1])  # mark where quality ends

            cq, offset = self.mark_chunk(cq, [(start, end)], "EC", offset, counter)  # substitute quality with EC identifier
            counter += 1  # the next EC chunk should have a new, bigger identifier, for example EC2

        for chunk in doc.noun_chunks:  # for each EC chunk candidate detected
            (start, end) = _get_EC_span_reject_wh_starters(chunk)  # check where chunk begins and ends

            ec = cq[start - offset:end - offset]  # extract text of potential EC, apply offsets

            if ec.lower() in rejecting_ec:  # if it should be rejected - do nothing
                continue

            if "the thing" in ec and end - start > len("the thing"):
                cq = cq[:start - offset] + "EC" + str(counter) +\
                    " EC" + str(counter + 1) + cq[end - offset:]
                counter += 2
                offset += (end - start) - 7
            else:
                cq, offset = self.mark_chunk(cq, [(start, end)], "EC", offset, counter)
                counter += 1

        if len(doc) >= 3 and ((doc[-2].pos_ == 'VERB' and doc[-3].text in ['are', 'is', 'were', 'was'] and doc[-1].text == '?') or (doc[-2].pos_ in ['ADJ', 'ADV'] and doc[-1].text == '?')):
            # if CQ ends with are/is/were/was + VERB + ? or the last token is ADJective or ADVerb, treat the
            # verb / adverb / adjective as EC
            # Which animals are endangered -> endangered is EC
            # Which animals are quick -> quick is EC
            if doc[-2].text.lower() not in rejecting_ec:
                start = doc[-2].idx
                end = start + len(doc[-2])

                cq, offset = self.mark_chunk(
                    cq, [(start, end)], "EC", offset, counter)
                counter += 1

        return cq

    def get_PCs_as_spans(self, cq):
        def _is_auxilary(token, chunk_token_ids):
            """
                Check if given token is an auxilary verb of detected PC.
                The auxilary verb can be in a different place than the main part
                of the PC, so pos-tag-sequence based rules don't work here.
                For example in "What system does Weka require?" - the main part
                of PC is the word 'required'. The auxilary verb 'does' is separeted
                from the main part by 'Weka' noun. Thus dependency tree is used
                to identify auxilaries.
            """
            if (token.head.i in chunk_token_ids and  # if dep-tree current token's parent (head) is somewhere inside the main part of PC represented as chunk_token_ids (sequence of numeric token identifiers)
                    token.dep_ == 'aux' and  # if the dep-tree label on the edge between some word from main part of PC and current token is AUX (auxilary)
                    token.i not in chunk_token_ids):  # if token is outside of detected main part of PC
                return True  # yep, it's auxilary
            else:
                return False

        def _get_span(group, doc):
            id_tags = group.split(",")
            ids = [int(id_tag.split("::")[0]) for id_tag in id_tags]
            aux = None
            for token in doc:
                if _is_auxilary(token, ids):
                    aux = token

            return (doc[ids[0]].idx, doc[ids[-1]].idx + len(doc[ids[-1]]),
                    aux)

        def _reject_subspans(spans):
            """
                Given list of (chunk begin index, chunk end index) spans,
                return only those spans that aren't subspans of any other span.
                For instance form list [(1,10), (2,5)], the second span
                will be rejected because it is a subspan of the first one.
            """
            filtered = []
            for i, span in enumerate(spans):
                subspan = False
                for j, other in enumerate(spans):
                    if i == j:
                        continue

                    if span[0] >= other[0] and span[1] <= other[1]:
                        subspan = True
                        break
                if subspan is False:
                    filtered.append(span)
            return filtered

        doc = nlp(cq)

        """
            Transform CQ into a form of POS-tags with token sequence identifier.
            Each token is described with "{ID}::{POS_TAG}".
            Tokens are separated with ","
            Having that form, we can extract longest sequences of expected pos-tags
            using regexes. The extracted parts can be explored to collect identifiers
            of tokens, so we know where they are located in text.
            Ex: "Kate owns a cat" should be translated into: "1::NOUN,2::VERB,3::DET,4::NOUN"
        """
        pos_text = ",".join(
            ["{id}::{pos}".format(id=id, pos=t.pos_) for id, t in enumerate(doc)])

        regexes = [   # rules describing PCs
            r"([0-9]+::(PART|VERB),?)*([0-9]+::VERB)",
            r"([0-9]+::(PART|VERB),?)+([0-9]+::AD(J|V),)+([0-9]+::ADP)",
            r"([0-9]+::(PART|VERB),?)+([0-9]+::ADP)",
        ]

        spans = []  # list of beginnings and endings of each chunk
        for regex in regexes:  # try to extract chunks with regexes
            for m in re.finditer(regex, pos_text):
                spans.append(_get_span(m.group(), doc))  # get chunk begin and end if matched
        spans = _reject_subspans(spans)  # reject subspans
        return spans

    def extract_PC_chunks(self, cq):
        rejecting_pc = ['is', '痴', 'are', 'was', 'do', 'does', 'did', 'were',
                        'have', 'had', 'can', 'could', 'categorise', 'regarding',
                        'is of', 'are of', 'are in', 'given', 'is there']

        offset = 0
        counter = 1

        for begin, end, aux in self.get_PCs_as_spans(cq):
            if cq[begin - offset:end - offset].lower() in rejecting_pc:
                continue
            spans = [(begin, end)]
            if aux:
                spans.insert(0, (aux.idx, aux.idx + len(aux)))

            cq, offset = self.mark_chunk(cq, spans, "PC", offset, counter)
            counter += 1
        return cq

# post abstraction processing
def post_abstract(cq_path, patterns_path=None):
    pattern_abstraction= AbstractPattern()
    genQuestion=[] 
    splitQuestions =[]
    patterns = []
    pattern_candidates = {}
    T5Cqs_patterns = []
    with open(cq_path, 'r') as f:
      for line in f.readlines():
        line= line.replace('?', '? ')
        line1= line.replace('??', '?')
        line2 = line1.split("?")
        line3= [p.join(' ?') for p in line2]
        line3 = [p.lstrip() for p in line3]
        genQuestion.append(line3)
    genQuestionDF= pd.DataFrame(genQuestion)
    genQuestionDF.columns=['questions', 'first','second']
    print("genQuestionDF this is problematic", genQuestionDF.head())
   
    allList=[]
    pat_candidates={}
    for sublist in  genQuestion: 
        final = []
        for i in sublist:
            if(i==''):
                continue
            for item in i.split(','):
                pat = pattern_abstraction.extract_EC_chunks(item)
                pat = pattern_abstraction.extract_PC_chunks(pat)
                final.append(pat)
                pat_candidates[item]=(pat)
        allList.append(final)
    for elem in patterns:
        T5Cqs_patterns.append(elem)
    
    if patterns_path is None:
        patterns_path = "outputs/euai/CQs_patterns.txt"
    with open(patterns_path, "w") as file:
        file.write(str(pat_candidates))
    PatternsDF = pd.DataFrame(pat_candidates.items())
    PatternsDF.columns = ['questions', 'patterns']
    print("pat_candidates", PatternsDF.head())
    print(PatternsDF.columns)
    print("length of pat_candidates", len(PatternsDF))
    return allList, pat_candidates, PatternsDF 

# save to file for human review where necessary. you import back into the process afterwards here
def processCQs(absWithCQs, generated_cqs_path=None, templates_path=None):
    print("absWithCQs",absWithCQs.columns)
    print("absWithCQs size",len(absWithCQs))
    print("absWithCQs",absWithCQs.head())
    if generated_cqs_path is None:
        generated_cqs_path = os.getcwd() + "/outputs/euai/geneCQsNov.csv"
    if templates_path is None:
        templates_path = os.getcwd() + "/CLaROv2.csv"
    absWithCQs.to_csv(generated_cqs_path, sep='|')
    templates= pd.read_csv(templates_path, sep = ";")
    templates.columns = ['ID', 'patterns']
    print("templates",templates.head())
    return absWithCQs, templates

def compare_patterns(absWithCQs, templates, generated_patterns_path=None, distinct_patterns_path=None):
    check = pd.merge(absWithCQs, templates, on=['patterns'], how='left', indicator='Exist')
    generated_CQs_with_patterns = check[check['Exist'] == 'both']
    check_with_cqPatterns_only = check[check['Exist'] == 'left_only']
    check_in_templates_only = check[check['Exist'] == 'right_only']
    if generated_patterns_path is None:
        generated_patterns_path = os.getcwd() + "/outputs/euai/generated_CQs_with_patterns.csv"
    if distinct_patterns_path is None:
        distinct_patterns_path = os.getcwd() + "/outputs/euai/distinct_patterns.csv"
    generated_CQs_with_patterns.to_csv(generated_patterns_path, sep='|')
    distinct_patterns = generated_CQs_with_patterns.drop_duplicates(subset='patterns', keep="first")
    distinct_patterns.to_csv(distinct_patterns_path, sep='|')
    return distinct_patterns, check_in_templates_only, check_with_cqPatterns_only, generated_CQs_with_patterns

#semantic similarity to check CQs that are the same and should be dropped and also find questions that not similar
def final_output(
    genQuestionDF2,
    semantic_cqs_path=None,
    non_duplicate_path=None,
    semantic_tokenizer=None,
    semantic_model=None,
):
    if semantic_tokenizer is None or semantic_model is None:
        model_id: str = "sentence-transformers/all-MiniLM-L6-v2"
        semantic_tokenizer = AutoTokenizer.from_pretrained(model_id)
        semantic_model = AutoModel.from_pretrained(model_id).to(device)
    tokenizer = semantic_tokenizer
    max_length = 128
    model = semantic_model
    model.eval()
    print("length of used corpus", len(genQuestionDF2))
    #  code below modified
    sim_corpus = genQuestionDF2['questions'].dropna().astype(str).tolist()
    
    usedCorpus = list(set(sim_corpus))
    print("length of used corpus", len(usedCorpus), type(usedCorpus))
    
    query_Corpus = list(set(sim_corpus))
    print("length of query corpus", len(query_Corpus))
    #Compute embedding for both lists
    encode = tokenizer(
                usedCorpus,
                padding=True,
                truncation=True,
                max_length=max_length,
                return_tensors="pt",
            ).to(device)
    with torch.no_grad():
        corpus_embed = model(**encode).last_hidden_state[:,0,:]
    semanticCQs= {}
    top_k = min(5, len(usedCorpus))
    for qry in query_Corpus:
        query_tokens = tokenizer(
            [qry],  
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        ).to(device)
        
        with torch.no_grad():
            query_embed = model(**query_tokens).last_hidden_state[:,0,:]
        cos_scores = util.cos_sim(query_embed, corpus_embed)[0]
        top_results = torch.topk(cos_scores, k=top_k)

        semanticCQs[qry] = []
        
        for score, idx in zip(top_results[0], top_results[1]):
            new_score= "{:.4f}".format(score)
            new_score= float(new_score)
            if  new_score <= 0.7500:
                semanticCQs[qry].append({usedCorpus[idx]: (new_score)})
        
    QuesSimilar= pd.json_normalize([ {"firstCQs": key_, "secondCQs" : i, "score" : child[i] }  for key_ in semanticCQs for child in semanticCQs[key_] for i in child ])
    if semantic_cqs_path is None:
        semantic_cqs_path = os.getcwd() +  "/outputs/euai/semanticCQs.csv"
    if non_duplicate_path is None:
        non_duplicate_path = os.getcwd() + "/outputs/euai/nonDuplicate.csv"
    QuesSimilar.to_csv(semantic_cqs_path, sep='|')
    if not QuesSimilar.empty:
        # Merge on the questions column (firstCQs matches with questions)
        merged_df = genQuestionDF2.merge(
            QuesSimilar,
            left_on='questions',
            right_on='firstCQs',
            how='inner' 
        )
        # Optional: Drop the duplicate firstCQs column since it's the same as questions
        if 'firstCQs' in merged_df.columns:
            merged_df = merged_df.drop('firstCQs', axis=1)
        # Rename columns for clarity if needed
        merged_df = merged_df.rename(columns={
            'secondCQs': 'similar_question',
            'score': 'similarity_score'
            })
    else:
        merged_df = pd.DataFrame()
        print("No similar questions found with score <= 0.75")
    
    # Save the merged dataframe
    if not merged_df.empty:
        merged_df.to_csv(non_duplicate_path, sep='|')
    print(merged_df.columns)
    print("length of merged_df:", len(merged_df))
    print("length of QuesSimilar:", len(QuesSimilar))
    return QuesSimilar,merged_df

############################################

def get_files(path):
    file_names = [file_name for file_name in os.listdir(path) if os.path.isfile(os.path.join(path, file_name))]
    file_paths = [os.path.join(path, file_name) for file_name in file_names]
    return file_paths

def process_base_path(base_path, output_dir, templates_path):
    os.makedirs(output_dir, exist_ok=True)

    workdir = os.listdir(base_path)
    if ".DS_Store" in workdir:
        workdir.remove(".DS_Store")
    print(base_path)

    file_paths = get_files(base_path)

    for file_path in file_paths:
        if file_path.endswith(".pdf"):
            key_name = Path(file_path).stem
            file_path_no_ext = os.path.join(base_path, key_name)
            out_file = os.path.join(base_path, f"{key_name}.txt")
            print(f"Processing {file_path_no_ext}...")
            with open(file_path, "rb") as f:
                text = extract_pdf(f)
            with open(out_file, "w", encoding="utf-8") as extract:
                extract.write(text)
            print(f"Extracted text from {file_path} and saved to {out_file}")

    cleaned_text_path = os.path.join(output_dir, "cleaned_text.csv")
    cqs_path = os.path.join(output_dir, "CQs.csv")
    cq_output_path = os.path.join(output_dir, "cq_output.txt")
    patterns_path = os.path.join(output_dir, "CQs_patterns.txt")
    semantic_cqs_path = os.path.join(output_dir, "semanticCQs.csv")
    non_duplicate_path = os.path.join(output_dir, "nonDuplicate.csv")
    generated_cqs_path = os.path.join(output_dir, "geneCQsNov.csv")
    generated_patterns_path = os.path.join(output_dir, "generated_CQs_with_patterns.csv")
    distinct_patterns_path = os.path.join(output_dir, "distinct_patterns.csv")

    df = readTextFile(base_path, text_path=cleaned_text_path)
    print("a look at dataframe", df.head(10))
    print("-------------------------------")
    path = generate(df, QUESTION_MODEL, QUESTION_TOKENIZER, device, path=cqs_path)
    print("-------------------------------")
    cq_path = postprocess(path, cq_path=cq_output_path)
    print("-------------------------------")
    allList, pat_candidates, patterns_df = post_abstract(cq_path, patterns_path=patterns_path)
    print("-------------------------------")
    similar_cqs_filter, merged_df = final_output(
        patterns_df,
        semantic_cqs_path=semantic_cqs_path,
        non_duplicate_path=non_duplicate_path,
        semantic_tokenizer=SEMANTIC_TOKENIZER,
        semantic_model=SEMANTIC_MODEL,
    )
    print("-------------------------------")
    absWithCQs, templates = processCQs(
        merged_df,
        generated_cqs_path=generated_cqs_path,
        templates_path=templates_path,
    )
    print("-------------------------------")
    distinct_patterns, check_in_templates_only, check_with_cqPatterns_only, generated_CQs_with_patterns = compare_patterns(
        absWithCQs,
        templates,
        generated_patterns_path=generated_patterns_path,
        distinct_patterns_path=distinct_patterns_path,
    )
    return {
        "all_list": allList,
        "pattern_candidates": pat_candidates,
        "similar_cqs_filter": similar_cqs_filter,
        "distinct_patterns": distinct_patterns,
        "check_in_templates_only": check_in_templates_only,
        "check_with_cq_patterns_only": check_with_cqPatterns_only,
        "generated_cqs_with_patterns": generated_CQs_with_patterns,
        "last_generated_file": cq_output_path,
    }


def run_pipeline(config: AppConfig):
    load_runtime_models(config)
    return process_base_path(
        base_path=str(config.input_dir),
        output_dir=str(config.output_dir),
        templates_path=str(config.templates_csv),
    )


@app.on_event("startup")
def startup_load_models():
    load_runtime_models(APP_CONFIG)


@app.post("/cq-suggestion")
async def cq_suggestion(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename.")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".pdf", ".txt"}:
        raise HTTPException(status_code=400, detail="Only .pdf and .txt files are supported.")

    load_runtime_models(APP_CONFIG)

    request_id = uuid.uuid4().hex
    request_root = APP_CONFIG.output_dir / "requests" / request_id
    request_input_dir = request_root / "inputs"
    request_output_dir = request_root / "outputs"
    request_input_dir.mkdir(parents=True, exist_ok=True)
    request_output_dir.mkdir(parents=True, exist_ok=True)

    uploaded_path = request_input_dir / file.filename
    content = await file.read()
    with open(uploaded_path, "wb") as out_file:
        out_file.write(content)
    await file.close()

    results = process_base_path(
        base_path=str(request_input_dir),
        output_dir=str(request_output_dir),
        templates_path=str(APP_CONFIG.templates_csv),
    )
    last_generated_file = Path(results["last_generated_file"])
    if not last_generated_file.exists():
        raise HTTPException(status_code=500, detail="Pipeline did not produce the expected output file.")

    return FileResponse(
        path=str(last_generated_file),
        filename=last_generated_file.name,
        media_type="text/plain",
    )


def parse_args():
    parser = argparse.ArgumentParser(description="Run CQ generation pipeline.")
    parser.add_argument(
        "--project-root",
        default=os.getcwd(),
        help="Project root containing inputs/, outputs/, model/, and CLaROv2.csv.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    config = AppConfig.from_project_root(args.project_root)
    run_pipeline(config)


if __name__ == "__main__":
    main()
