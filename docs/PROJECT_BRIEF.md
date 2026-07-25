# 50.003 Elements of Software Construction — Project Brief

> Transcribed from the course handout (Restricted) plus the three DAS D.I.A.L. problem
> statement PDFs in the repo root. This file is the reference copy for the team.

## Our scope

We are building **Industry Project 2 — DAS Individualised AI-Based Learning System (D.I.A.L.)**,
covering three of the seven subsystems:

| # | Subsystem | PDF in repo | Status in this repo |
|---|-----------|-------------|---------------------|
| 1 | DAS Learning Screening Engine | `DAS DIAL PS 1.pdf` | Prototype started (`app/` — writing-sample screener) |
| 3 | DAS Adaptive Learning Activity Generator | `DAS DIAL Problem Statement 3_ Adaptive Learning Activity Generator.pdf` | Not started |
| 4 | DAS Error Pattern Analyzer | `DAS DIAL Problem Statement 4_ Error Pattern Analyzer.pdf` | Not started |

The handout requires solutions to **at least two** of the seven subsystems, "preferably on a
subset of the subsystems that are strongly connected." PS 1 → PS 4 → PS 3 form a natural chain:
screen the learner, analyse the error patterns in their work, then generate adapted activities
from that profile.

Note: PS 3 is flagged in its own PDF as *"The hardest of all DAS problem statements."*

---

# Part 1 — Course handout

## Project groupings (updated 15 May 2026)

- To propose your own project (start-up project), email the instructors by **28 May Thu 23:59**
  with detailed project descriptions, key deliverables and project timeline. Instructors decide
  whether the proposal is suitable.
  - Maximum two founding team members from the same cohort class. Instructors assign the rest.
  - Once cleared by the instructors, update the shared excel sheet.
- If you are not proposing a project, your group is assigned by the 50.003 instructors.
  - You can pick **one and only one** classmate within the same cohort class as your buddy, and
    update the excel sheet. Instructors will try to allocate you and your buddy to the same team.
  - Document your proposal by following the project topic section.
- If you are taking the 50.003 x 50.005 CoreStack project, you can put 3 names as buddy.

## Project topics

Students not initiating their own project may vote for one of the listed project topics, which
are supported by industry partners. Classmates proposing their own projects may have those added
to the topic list once approved.

## Industry Project 1 — Hotel Booking System Case Study

*(Not our project. Recorded here for completeness of the handout.)*

| Field | Detail |
|---|---|
| Title | Hotel Booking System Case Study |
| Industry Mentors | Mr Wilbert Aristo (wilbert.aristo@ascenda.com) |
| Project Context | Ascenda Loyalty provides white-labelled hotel booking platforms on behalf of banks, airlines and loyalty programs worldwide. Global customers earn and redeem hotel night stays using accumulated points. Features include text-based autocomplete search, aggregating hotel/destination searches from multiple suppliers, storage of booking data, etc. These features test data abstraction, good software design, scalability and security. |
| Project Objectives | Provide a real-world example of a scalable and secure software system; challenge students to produce good software design and practice when recreating (or improving) Ascenda's current features. |
| Project Deliverables | Simple web application and backend API server, security test cases, reports |
| Main form of deliverable | A web application |
| Crucial properties to test | Functionality, performance and security |
| Resources | Product overview: https://www.ascendaloyalty.com/travel-rewards — detailed case study write-up available on request: https://docs.google.com/document/d/1on8n1vYThtapSlQAqC93wsbAQoGy2fpL/ |
| Briefing | Teams meeting ID 431 690 005 105 96, passcode `Q3YL9wQ9` |

## Industry Project 2 — DAS Individualised AI-Based Learning System: D.I.A.L. (updated 29 May 2026)

**This is our project.**

| Field | Detail |
|---|---|
| Title | DAS Individualised AI-Based Learning System: D.I.A.L. |
| Industry Mentors | Ms Soofrina Binte Mubarak — soofrina@das.org.sg |
| Project Context | Dyslexia Association Singapore (DAS) began as a community project in 1989, raising dyslexia awareness through public forums. Inspired by the forums' success, a local dyslexia association was established in April 1991 and officially registered as DAS in October 1991. The mission is empowering those who learn differently, including those with dyslexia, to achieve their true potential. |
| Project Objectives | DAS aims to create AI-powered software to efficiently achieve individualisation and differentiation. The mega project suite is named D.I.A.L. |
| Project Deliverables | Refer to the attached sub-project problem statements (Part 2 below). |
| Main form of deliverable | Refer to the attached sub-project problem statements. |
| Crucial properties to test | Functionality, Performance, Security |
| Resources | https://das.org.sg/ |
| Common briefing | 3 Jun 2026, 2:30 PM Singapore — https://us06web.zoom.us/j/84097080069 |

### The seven D.I.A.L. subsystems

1. DAS Learning Screening Engine ← **ours**
2. DAS Cognitive Profiling System
3. DAS Adaptive Learning Activity Generator ← **ours**
4. DAS Error Pattern Analyzer ← **ours**
5. DAS Progress Monitoring System
6. DAS Intervention Recommendation Engine
7. DAS Parent Insight Dashboard

> Students are advised to provide solutions to **at least two** of the seven subsystems,
> preferably a subset that is strongly connected.

---

## Project Meeting 1 (5%)

- At least five use cases of your product — **2%**
- Clarification of doubts or gaps in the requirement — **1%**
- Development process, constraints and risks — **1%**
- Project timeline and distribution of workloads — **1%**

| Item | Poor | Fair | Excellent |
|---|---|---|---|
| **Documentation of use cases.** Are use cases clearly defined? | Use cases are not provided. (0) | Use cases are incoherently described (does not match the objective of the software product/tool). Not enough use cases. (1) | Complete and comprehensive description of use cases (at least five). Not mandatory at this stage, but good if each use case is described in the table format discussed in class. (2) |
| **Clarification of requirements.** An excerpt/summary of your discussion with the client (or with the instructor if self-proposed). | No summary. (0) | — | Provides a concise and coherent summary of discussion with the client. (1) |
| **Software development process and risk analysis.** What process do you foresee following (agile, incremental, prototyping, a combination)? What are the risks (e.g. inadequate knowledge about some tool, unknown programming language) and how will you mitigate them? | No discussion. (0) | Incomplete / incoherent / missing description for some points. For instance, development process is discussed yet risks are not well thought out. (0.5) | Complete and comprehensive description of the potential software development process. Risks are well described. (1) |
| **Project timeline.** What are the deliverables at each project meeting (2, 3, 4 and final presentation)? It can be an estimate at this stage and may change. | No discussion. (0) | Deliverables are not well thought of and/or not all deliverables for the project meetings are discussed. (0.5) | Complete and comprehensive description of all deliverables for each project meeting, starting from project meeting 2. (1) |

---

## Project Meeting 2 (5%)

- Any changes in requirement (compared to 1st meeting) — **1%**
- Formal documentation of use cases — **1%**
- Initial design (at least class diagrams and sequence diagrams of some essential use cases) — **1%**
- Implementation of some basic features (demo) — **1%**
- Feature progress records to show workload distribution — **1%**

| Item | Poor | Fair | Excellent |
|---|---|---|---|
| **Changes in requirement** *(in the report)* — any refinement/change since the last meeting? | Changes are not discussed. (0) | — | Changes are clearly identified and discussed in the report. If there are no changes since meeting 1, say so. For external projects, include a summary of discussion (if any) since project meeting 1. (1) |
| **Documentation of use cases** *(in the report)* | No use case. (0) | Incomplete and/or inconsistent use case diagram with respect to the project requirement. (0.5) | Complete and comprehensive use case diagram, consistent with the project requirement. If already drawn in the previous meeting, include the same if nothing changed. (1) |
| **Initial design** *(in the report)* | No class diagram. (0) | Incomplete class diagram — does not show all multiplicities or associations, does not comprehensively show class operations, or is inconsistent with the use case diagrams. (0.25) — Class diagram is comprehensive and consistent, but no sequence diagram modelled for critical workflows. (0.5) | Complete and comprehensive class diagram consistent with the use case diagrams. Additionally, sequence diagrams model some important workflows. (1) |
| **Implementation** *(shown in the meeting; no item required for the report)* — demo of "basic" features. Snapshots and pictures are not demos; the demonstration should be due to actual coding. "Basic" is hard to quantify — we do not penalise too few features at this stage; what matters is that coding was involved and the features are consistent with requirement and design. | No demonstration. (0) | Demonstration of basic features is shown, but is inconsistent with the requirement and not well connected with the use-case diagram/design. The demonstration is buggy (e.g. crashes) or was not due to actual coding. (0.5) | Demonstration of basic features without error, consistent with the use case diagram/design. At least one of frontend or backend features can be shown, e.g. making an API call with expected output, submitting a form to update a database, user page UI, etc. (1) |
| **Feature progress records to show workload distribution** | No record shown. (0) | — | Clear and detailed records showing workload distribution with appropriate breakdown. (1) Recommended to highlight deliverables via explicit reference to documentation in the submission or to the source code module. Mini in-person individual interviews may be conducted to verify contribution. If a feature is not implemented by the member (or there is no artefact proving accountability), instructors have the right to award 0 for this component. |

> Note: some projects may require system testing via crowdsourcing (e.g. testing with real users).
> If in doubt, consult an instructor and include it in your report.

---

## Project Meeting 3 (5%)

- Any changes in requirement and design (compared to 2nd meeting) — **0.5%**
- Complete design — **0.5%**
- Implementation of additional features (over last meeting) in your product (demo) — **1%**
- Test plan — **1%**
  - Unit test cases (of some core features). Test cases in table document format, not code.
  - Integration test cases (of some core features, backend/frontend), in table document format,
    not code. Describe what strategy is applied — decomposition or call graph, top-down or
    bottom-up.
  - *(Optional)* End-to-end testing for some use case / user story.
  - A timeline showing how the rest of the tests will be implemented and executed.
- Implementation of some tests (demo) — **1%**
- Feature progress records to show workload distribution — **1%**

| Item | Poor | Fair | Excellent |
|---|---|---|---|
| **Changes in requirement** *(in the report)* | Changes are not discussed. (0) | — | Changes are clearly identified and discussed in the report. If none since meeting 2, say so. For external projects, include a summary of discussion (if any) since project meeting 2. (0.5) |
| **Complete design** | No design or no progress after project meeting 2. (0) | — | All diagrams are complete — a complete set of use case diagram, class diagram and sequence diagram, correctly capturing all the features. (0.5) |
| **Implementation of additional features** (over last meeting). Discuss which use cases are fully / partially implemented and which are not yet implemented; briefly mention where you were at Project Meeting 2 and what additional progress you have made. | No demo or no progress after project meeting 2. Features developed without human evaluation. Implementation is frequently non-functional. (0) | Very slim progress since project meeting 2 and the plan about how to deliver in the final is unclear. Features developed with limited human evaluation. (0.5) | Demo is well prepared. Expected to have all functional features implemented. Existing bugs or errors can be pointed out. Demonstration in isolation (features not integrated) is allowed. Features implemented with full supervision and control by the human engineer. Clear plan on implementing the remaining features (if any). (1) |
| **Testing plan** *(in the report)* | No testing plan. (0) | Examples of unit testing tools, features/scenarios for unit testing. Tools identified for system testing (e.g. UI testing for web and mobile apps). However, no timeline is provided to carry out a detailed testing plan. (0.5) | Examples of unit testing tools, system testing tools (UI testing tools), features/scenarios for unit testing identified. Additionally, a detailed timeline is presented to carry out the test planning. (1) |
| **Implementation of some (unit) tests (demo).** Walking through the software is not a test. In general, if there is no coding, user study or crowdsourcing involved, there is no test. Unit tests must be written in proper test frameworks (e.g. Jest, RSpec or equivalent). You may augment the test suites with Postman, Cypress, Selenium, Cucumber. | No test is written / conducted (if user study) and the basic set of tests is reflected via using the software by its developers. There is a test, but no coding was involved (or no user study) to prepare it. (0) | Many tests are written and they run. Demonstration of test execution crashes, or the tests are not aligned with the project objectives / use cases. (0.5) | Many tests are well written; they run properly and are consistent with the use cases of the project. (1) |
| **Feature progress records to show workload distribution** | No record shown. (0) | — | Clear and detailed records showing workload distribution with appropriate breakdown. (0.5) Same accountability rules as Meeting 2. **Everyone must contribute. Individual penalty for those who don't.** |

---

## Final project presentation and reports (capped at 25%)

### Group report and code repo (15% + 1% bonus)

- Requirement — **2%**
- Design — **3%**
- Implementation challenges — **2%**
- Testing
  - Unit testing backend and frontend — **3%**
  - Integration testing — **2%**
  - System end-to-end testing — **1%**
  - Robustness testing — **1%**
- Feature progress records to show workload distribution — **1%**
- For industry-backed projects: obtain **written approval from your industry mentors** that your
  submission includes code, data samples and other IP belonging to the industry partner's business.
- Discuss the impact of your project on **sustainability**, and any consideration for **diversity
  and inclusion** (e.g. different cultures, demographic groups). You may discuss how your project
  contributes to the UN SDGs: https://sdgs.un.org/goals — **bonus 1%**

### Individual report and peer review (5%)

Sections required:

- Contribution to requirement formulation and refinement
- Contribution to the design
- Contribution to the implementation — clearly articulate which subsystems you implemented
- Contribution to testing — clearly articulate which types of tests you designed and developed
- An **AI hallucination diary**
- Reflection. If the project was not successful (in your opinion), what is the main reason behind
  the failure?

Constraints:

- Max 3 pages.
- You must also submit your peer review evaluation. **If you do not submit, your individual report
  mark is 0.** Peer evaluation results are compiled and used to moderate individual report marks.
  If peer evaluation shows you did not contribute, instructors may investigate further and
  moderate your group marks.

### Final presentation (5%)

- 15-minute presentation including a demo of the product and a short video giving a high-level
  description of the software and how it was tested.
- The video must be **no longer than 3 minutes**. It is backup material in case of technical
  problems. The school may seek permission to use the videos for future events and publicity.
- For industry-backed projects, obtain written approval from your industry mentors that the video
  may contain information, data and IP belonging to the industry partner's business.
- A well-planned, clear and concise presentation helps graders appreciate your reports and
  contributions.

### Final report grading rubrics

| Item | Poor | Fair | Excellent |
|---|---|---|---|
| **Requirement** — detailed description via use case diagram | No use case diagram. (0) | Some use case diagram, yet incomplete (does not cover all features) or incomprehensive, or no misuse cases were modelled. (1) | Complete and comprehensive use case diagram clearly showing the different features of the product. Comprehensively models **misuse cases**. (2) |
| **Design** — design of different subsystems via UML diagrams | No class diagram nor sequence diagram. (0) | Class diagram is present but incomplete — does not show all associations or multiplicities, does not comprehensively show class operations, or is inconsistent with the use case diagram. (1) — Class diagram is complete and consistent with the use case diagram, but does not comprehensively model sequence diagrams to reflect product workflow. (2) | Complete, comprehensive and consistent class diagram with respect to its use case diagram. Sequence diagrams are as comprehensive as possible to reflect detailed usage scenarios. (3) |
| **Implementation challenges** — split into (1) algorithmic challenges, (2) engineering challenges (tooling, integration issues), (3) testing challenges. Every project should have at least engineering and testing challenges; algorithmic challenges may be specific to a few projects (e.g. games). | No discussion on challenges. (0) | Challenges are outlined, yet there is no comprehensive description of what measures were taken to overcome them, or these challenges were not addressed in the project. (1) | Clearly outlines the challenges and comprehensively describes how they were addressed or what alternative measures were taken. (2) |
| **Unit testing** — implementation and demonstration of unit tests. Walking through the software is not a test. Test cases must be written using a testing framework such as Jest, RSpec or equivalent. | No test, or no progress compared to meeting 3. There are some additional unit tests but no coding was involved. (0) | Frontend or backend unit testing is missing. Testing was done only based on user stories; alternative and error scenarios are not covered. Demonstration of test execution crashes, or tests are not aligned with the project objectives/use cases. (1) | Extensive unit testing. Tests run properly and are consistent with the use cases. **Boundary tests and negative case tests are included.** (3) |
| **Integration testing** — implementation and demonstration of integration tests, using a framework such as Jest or JUnit. | No test, or no progress compared to meeting 3. No integration testing plan. There are some additional integration tests but no coding was involved. (0) | Frontend or backend integration testing is missing. Demonstration of test execution crashes, or tests are not aligned with the project objectives / sequence diagram / use cases. (1) | Extensive integration testing, faithfully reflecting the integration test plan. Tests run properly and are consistent with the use cases and sequence diagrams. (2) |
| **System testing and robustness testing** — how was the product tested? Clearly articulate what features were tested, the process followed, the tools used and the findings. You are encouraged to use automated end-to-end testing tools such as Cypress. | No proper testing, or code-a-bit-test-a-bit type of testing. (0) | Only system testing, but no testing to check robustness. For games, both system and robustness testing can be done by game players. (1) | System and robustness testing performed comprehensively and described in the report in detail. (2) |
| **Feature progress records to show workload distribution** | No record shown. (0) | There are records showing the workload distribution with appropriate breakdown. (0.5) | Clear and detailed records showing workload distribution with appropriate breakdown. The progress of the project reflects clear project management work in rescheduling and balancing workload. (1) Same accountability rules as earlier meetings. **Everyone must contribute. Individual penalty for those who don't.** |

---

## What robustness testing should I plan?

- Find **fuzzing targets** in your project.
- Use any language/platform to implement a fuzzer.
- Ideally the fuzzer should be able to run and generate tests over a very long period (e.g. 24 hours).
- The final version of the fuzzer may not be ready by Project Meeting 3, but **it should be ready
  by the final presentation**.
- If time permits, try:
  - https://jmeter.apache.org/
  - https://hypothesis.readthedocs.io/en/latest/
  - https://github.com/dubzzz/fast-check

---

# Part 2 — Our three problem statements

## Problem Statement 1 — DAS Learning Screening Engine

| Field | Detail |
|---|---|
| Title | DAS Learning Screening Engine |
| Industry Mentors | Ms Soofrina Mubarak, Ms Hakimah Diniyah |
| Project Context | DAS supports students with dyslexia and other learning differences through specialised literacy intervention programmes. Early identification of literacy difficulties remains a major challenge, as many students are only referred after prolonged academic struggle. Existing screening processes can be resource-intensive and may not provide sufficient granularity for targeted intervention planning. DAS is exploring an AI-assisted Learning Screening Engine that uses short digital cognitive and literacy tasks to identify early indicators of literacy risk, supporting scalable, data-informed screening for students with reading and writing difficulties. |
| Main form of deliverable | A web-based AI-assisted literacy screening platform |
| Crucial properties to test | Functionality, Accuracy, Interpretability, Usability, Security |
| Resources | www.das.org.sg |

**Project objectives** — how can machine learning and educational technology be utilised to:

- Develop a digital literacy screening platform for students
- Analyse learner responses and behavioural patterns
- Predict potential literacy risk indicators using AI/ML models
- Generate interpretable screening summaries for educators
- Support earlier intervention and referral decisions

**Deliverables** — presentation with demo of prototype.

Prototype technical requirements:

- Web-based application using frontend and backend frameworks
- Database for storing anonymised screening results
- AI/ML classification model for literacy risk prediction
- Dashboard for visualising screening outcomes
- Test cases and evaluation metrics

Documentation:

- Architecture diagram and design decisions
- Machine learning pipeline and preprocessing workflow
- Dataset structure and feature engineering rationale
- Project management methodology
- User testing findings and evaluation

## Problem Statement 3 — DAS Adaptive Learning Activity Generator

> Labelled in the source PDF as **"The hardest of all DAS problem statements."**

| Field | Detail |
|---|---|
| Title | DAS Adaptive Learning Activity Generator |
| Industry Mentors | Ms Soofrina Mubarak |
| Project Context | DAS supports students with dyslexia and other learning differences through specialised literacy intervention programmes. Educational therapists spend significant time creating differentiated worksheets, reading passages and learning activities tailored to individual student needs. This process is labour-intensive and difficult to scale across large student populations. DAS is exploring the use of Generative AI to support adaptive learning activity generation aligned to literacy goals, student profiles, and instructional scope-and-sequence frameworks. |
| Main form of deliverable | An AI-assisted adaptive learning activity generation platform |
| Crucial properties to test | Pedagogical Accuracy, Functionality, Reliability, Safety, Usability |
| Resources | www.das.org.sg |

**Project objectives** — how can generative AI and Retrieval-Augmented Generation (RAG) be utilised to:

- Generate differentiated literacy learning activities
- Align generated content with student learning profiles
- Retrieve pedagogically appropriate instructional strategies from a structured knowledge base
- Support educators in creating scalable customised learning materials
- Reduce educator preparation workload while maintaining instructional quality

**Deliverables** — presentation with demo of prototype.

Prototype technical requirements:

- Web application integrating LLM APIs or open-source LLMs
- Retrieval-Augmented Generation (RAG) pipeline
- Curriculum knowledge base
- Prompt engineering and content moderation pipeline
- Database for generated activity storage
- Evaluation framework for generated educational quality

Documentation:

- AI architecture and prompt pipeline
- RAG workflow and retrieval strategy
- Safety and responsible AI considerations
- Project management methodology
- Evaluation and benchmarking findings

## Problem Statement 4 — DAS Error Pattern Analyzer

| Field | Detail |
|---|---|
| Title | DAS Error Pattern Analyzer |
| Industry Mentors | Ms Soofrina Mubarak, Ms Kalphna C. |
| Project Context | DAS supports students with dyslexia and other learning differences through specialised literacy intervention programmes. Students with dyslexia and related learning differences often display recurring spelling and writing error patterns. Identifying these patterns manually requires significant educator expertise and time. DAS is exploring an NLP-assisted Error Pattern Analyzer capable of automatically detecting and categorising literacy-related writing errors from student work samples. |
| Main form of deliverable | An AI-assisted student writing diagnostic platform |
| Crucial properties to test | Accuracy, Interpretability, Functionality, Security, Reliability |
| Resources | www.das.org.sg |

**Project objectives** — how can NLP and AI techniques be utilised to:

- Analyse student writing samples
- Detect recurring spelling and literacy-related error patterns
- Categorise errors (e.g. phonological, orthographic, morphological)
- Generate interpretable diagnostic summaries for educators
- Support data-informed intervention planning

**Deliverables** — presentation with demo of prototype.

Prototype technical requirements:

- NLP-enabled web application
- Text ingestion and analysis pipeline
- Error classification and tagging system
- Database for storing writing samples and analytics
- Dashboard for visualising learner error trends
- Test cases and evaluation metrics

Documentation:

- NLP architecture and tokenisation strategy
- Error taxonomy and classification rationale
- AI evaluation methodology
- Project management methodology
- User testing findings

---

# Part 3 — Cross-cutting requirements to keep in mind

Things the rubric asks for that are easy to lose marks on, gathered in one place:

1. **Misuse cases** must be modelled in the final use case diagram — not just use cases.
2. **Class + sequence diagrams** must stay consistent with the use case diagram across all three
   meetings; the final report needs comprehensive sequence diagrams, not just a class diagram.
3. **Unit tests in a real framework** (Jest for this Next.js codebase), covering **boundary and
   negative cases**, on both frontend and backend.
4. **Integration tests** on both frontend and backend, traceable to the sequence diagrams.
5. **End-to-end system tests** — Cypress is explicitly encouraged.
6. **A fuzzer** for robustness testing, capable of running ~24 hours, ready by the final
   presentation. `fast-check` is the natural fit for a JS/TS codebase.
7. **Feature progress records** with per-member breakdown, referenced explicitly to source modules
   or documentation. Individual interviews may verify contributions; unverifiable contributions
   can score 0.
8. **Written approval from the DAS industry mentors** for any DAS code, data samples or IP
   included in the submission and the presentation video.
9. **AI hallucination diary** in each individual report (max 3 pages).
10. **Sustainability + diversity and inclusion / UN SDG** discussion for the 1% bonus. DAS work
    maps naturally onto SDG 4 (Quality Education) and SDG 10 (Reduced Inequalities).
