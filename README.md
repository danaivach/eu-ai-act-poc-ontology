# EU AI Act PoC Ontology
A Proof-of-Concept (PoC) Ontology for representing the main elements of the EU AI Act (Regulation (EU) 2024/1689).

## Table of Contents

## Ontological Model

### Scope of the Ontology
The scope of the EU AI Act PoC Ontology is selected on the basis of 
<details>
<summary>AI Systems (example CQs)</summary>

- What is the (risk-based) _system type_ of a given _AI system_?
- What is the (domain-based) _system type_ of a given _AI system_?
- What are the _components_ of a given _AI system_?
- What are _systems_ that have ...

</details>
<details>
<summary>Operators (example CQs)</summary>

- What are the types of _operators_ under the _EU AI Act_?
- What is the _intended purpose_ of a given _operator_?

</details>
</details>
<details>
<summary>Authorities (example CQs)</summary>

- - What are the _authorities_ 

</details>

<details>
<summary>Prohibited AI Practices (example CQs)</summary>

- What are the types of _prohibited practices_ under the _EU AI Act_?
- What are the _prohibited practices_ that are _assigned to_ a given _operator_?
- What are the _prohibited practices_ that are _assigned by_ a given _authority_?
- What are the _prohibited practices_ that _target_ a given _AI system_?
- What are the _prohibited practices_ for a given _action_ applied to an AI system by an operator?
- What are the _prohibited practices_ that set _constraints_ on the _intended purpose_ of an operator to use an AI system?

</details>

> [!NOTE]
> **RATIONALE**
> 
>The competency questions (CQs) above establish a baseline set of modelling decisions and TBox for the ontology.
> This foundation makes it straightforward to extend the model to cover:
> - additional AI system types and components (e.g., classification rules for general-purpose AI models and operators);
> - additional EU AI Act rule types, such as transparency obligations depending on the system domain or operator type;
> - further classifiers and relationships for operators, authorities, actions, AI systems, and components (e.g., risk-based or domain-based classifications).
>
> The scope of the CQs was defined during the initial scoping stage of the AI-assisted pipeline, which identified _compliance checking_ and _AI system classification_ as key focus areas. In this context, the ontology provides a baseline for the automation of manual compliance checkers (e.g., the [FutureOfLife compliance checker](https://artificialintelligenceact.eu/assessment/eu-ai-act-compliance-checker/)) against AI system profiles. It can also complement existing predictive AI approaches (cf. the [EU-AI-Act-Flagged dataset](https://huggingface.co/datasets/suhas-km/EU-AI-Act-Flagged)) with symbolic AI methods for compliance assessment.

### Key Modelling Decisions and Ontology Reuse
**Formalisation:** We chose **OWL**, the W3C standard for formal ontology modeling, because it provides the expressivity and reasoning support needed for this PoC ontology (class hierarchies, property restrictions, disjointness, equivalence). This allows us to capture the requirements for AI system classification and compliance rules without relying on heavier or complementary approaches (e.g., SWRL, or RDF★).

**Scoping, Conceptualisation, and Granularity level**: The ontology focused on _compliance checking_ and _AI system classification_, (e.g., informed by GitHub repositories, datasets discovered via [Google Dataset Search](https://datasetsearch.research.google.com/), and automatic CQ generation over the [EU AI Act text](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202401689); see X ). This produced a high-level set of terms as a starting point (e.g., _AI System_, _High-Risk AI System_, _Provider_, _General-Purpose AI Model_), refined using [OntoScope](https://github.com/King-s-Knowledge-Graph-Lab/OntoScope) to audit domain boundaries based on lateral and vertical thinking, and grounded where possible through reuse of existing ontologies such as [ELI](https://op.europa.eu/en/web/eu-vocabularies/dataset/-/resource?uri=http://publications.europa.eu/resource/dataset/eli), [ODRL](https://www.w3.org/TR/odrl-model/), [Sysmo](http://sysmo.org/), and [Eurovoc](https://eur-lex.europa.eu/browse/eurovoc.html) to support semantic interoperability and sufficient semantic coverage for a PoC ontology. We maintained a pragmatic, extensible granularity, while providing targeted high-detail examples to illustrate design choices. The latter includes application-domain individuals (e.g., _toy_, _radio equipment_) and specific prohibitions, such as restricting the placing on the market, putting into service, or use of AI systems that employ subliminal or manipulative techniques beyond a person's awareness. 

**Definitions and Article References**: Term names, definitions and labels (_rdfs:comment_, _rdfs:label_) were directly derived from the [EU AI Act](https://eur-lex.europa.eu/eli/reg/2024/1689/oj). In addition, each term was associated to the EU AI Act article or annex that it references (_eli:refers_to_) using the ELI ontology. ELI defines a common data model for exchanging legislation metadata on the Web, and the EU AI Act and its legal resource subdivisions (articles, annexes, etc.) are already identified through ELI-compliant URIs. Therefore, all references in our ontology were implemented following the [ELI technical implementation guide](https://op.europa.eu/documents/2050822/2138819/ELI+-+A+Technical+Implementation+Guide.pdf/), ensuring consistency and traceability with other legal resources and expressions (_eli:LegalResource_, _eli:LegalResourceSubdivision_, _eli:expression_.

<details>
<summary>Example CQ</summary>

**CQ:**  Which legal resource subdivisions (articles, annexes, etc.) are referenced by the definition of a `:SafetyComponent`, and what are their types, descriptions, and parent legal resources?

**SPARQL Query:**
```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX eli: <http://data.europa.eu/eli/ontology#>
PREFIX euaiact: <https://eur-lex.europa.eu/eli/reg/2024/1689/oj#>
PREFIX : <http://example.org/ontologies/eu-ai-act/>

SELECT ?legalResourceSubdivision ?type ?comment ?legalResource
WHERE {
  :SafetyComponent eli:refers_to ?legalResourceSubdivision .
  ?legalResourceSubdivision rdf:type ?type .
  ?legalResourceSubdivision rdfs:comment ?comment .
  ?legalResourceSubdivision eli:is_part_of ?parentLegalResource .
}
```

| ?legalResourceSubdivision | ?type                          | ?comment                                                 | ?parentLegalResource |
|---------------------------|--------------------------------|----------------------------------------------------------|---------------------|
| euaiact:art_3             | eli:LegalResourceSubdivision   | "Article 3 of the Regulation (EU) 2024/1689 (EU AI Act)." | euaiact:           |

</details>






### 

## AI-assisted Pipeline

![Diagram of our 3-step experimental pipeline for ontology engineering. The diagram was generated with [PaperBanana](https://paperbanana.me/)](/experimental-ai-pipeline-diagram.png)
Diagram of our 3-step experimental pipeline for ontology engineering. The diagram was generated with [PaperBanana](https://paperbanana.me/).

We followed an experimental AI-assisted pipeline through the following Steps 1-3:

1. **Scoping and informal CQs:** In Step 1, we defined an initial set of **subdomains and CQs** using automated and manual methods:

- Generated subdomains from [**GitHub READMEs** tagged with "EU AI Act"](https://github.com/search?q=eu%20ai%20act&type=repositories) using **GPT-4.1**. This helped to identify the types of software projects where the ontology could be applied in practice (e.g., "AI Risk Classification", and "Complicance Checking").
- Generated candidate CQs from the **EU AI Act text** using a **LoRA/T5 model**, which we trained according to [1]. This helped to identify legal terms and requirements that are legally grounded through the EU AI Act (e.g., "What is an authorised representative?", "What is the list of prohibited practices set out in the Article?").
- Extracted subdomains from selected **scenario-based stories** from the [EU-AI-Act-Flagged training dataset](https://huggingface.co/datasets/suhas-km/EU-AI-Act-Flagged/tree/main) via GPT-4.1. This helped to identify additional terms and CQs that derive from application-domain-specific and context-rich subdomains (e.g., "What explains the system's purpose in a smart city?").
- After manual refinement, candidates were fed to [OntoScope](https://github.com/King-s-Knowledge-Graph-Lab/OntoScope), and the final set of **terms and associated CQs** was determined manually.

2. **Glossary and Formal CQs**: Step 1 output was formalised to create a glossary and executable CQs:

- Generated **SPARQL queries and glossary definitions** for each term using GPT-4.1. This helped the fast transition from ideation to a setup for prototyping.
- Decided on the integration of **existing ontologies** based on Step 1 discoveries and contributor expertise.
- Refined SPARQL queries and definitions to ensure **syntactic correctness**, and **semantic compliance** with the EU AI Act.


3. **Test-driven ontology population and validation**: Step 3 combined AI-assisted updates with manual curation:

- A **PoC ReAct-based [2] AI agent** iteratively:
  - retrieves SPARQL queries and the current TBox and ABox,
  - updates the TBox and ABox,
  - validates queries against the ontology, and
  - checks if results are consistent.
- **`rdflib`** was used to manage RDF resources and SPARQL execution, while [owl-mcp](https://github.com/ai4curation/owl-mcp) allowed the agent to update the ontology using **MCP tools** concurrently with the contributor in **Protégé**, ensuring visibility and manual intervention.
- Agent performance was **limited**, producing only some high-level classes correctly. Better feedback and context engineering are needed to produce a more viable solution inspired by the **TDD-like processes of the SAMOD methodology**.
- Significant **manual curation** in Protégé was required to handle complex axioms, cross-ontology dependencies, and ensure correctness.

Throughout Steps 1–3, we used a mix of Claude Code (Anthropic's agentic coding tool), OpenAI's Codex (the ChatGPT‑integrated coding agent), and ChatGPT (general‑purpose LLMs such as GPT‑4.1) depending on the task at hand. Scripts were implemented in TypeScript and Python, as an extension of OntoScope or separate projects.

## Limitations and Future Work
With respect to the ontology: 

## References
[1] Antia, M. J., & Keet, C. M. (2023). Automating the generation of competency questions for ontologies with agocqs. In Iberoamerican Knowledge Graphs and Semantic Web Conference.
[2] Yao, S., Zhao, J., Yu, D., Shafran, I., Narasimhan, K. R., & Cao, Y. (2022) ReAct: Synergizing Reasoning and Acting in Language Models. In NeurIPS 2022 Foundation Models for Decision Making Workshop.
