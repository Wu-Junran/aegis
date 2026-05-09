---
id: soap
name: SOAP Note
kind: clinical_note
sections:
  - id: subjective
    title: Subjective
    required_fields: ["chief_complaint", "hpi"]
    prompt_guidance: >
      Narrate the patient's chief complaint and history of present illness
      in the patient's own voice. Do not include objective measurements here.
  - id: objective
    title: Objective
    required_fields: ["vital_signs", "exam_findings"]
    prompt_guidance: >
      List measurable findings — vital signs, exam, relevant labs.
      Cite specific values from the Observation list only.
  - id: assessment
    title: Assessment
    required_fields: ["active_problems"]
    prompt_guidance: >
      Prioritized problem list with clinical reasoning for each.
      Tie each problem to supporting evidence from Subjective/Objective.
  - id: plan
    title: Plan
    required_fields: ["interventions"]
    prompt_guidance: >
      For each problem in Assessment, state diagnostic steps, therapeutic
      changes (with dosing), and follow-up.
---
# SOAP Note

**Patient:** {{ patient.demographics.name[0].given[0] }} {{ patient.demographics.name[0].family }} | **DOB:** {{ patient.demographics.birthDate }} | **Sex:** {{ patient.demographics.gender }}

## Subjective
{{ filled_sections.subjective }}

## Objective
{{ filled_sections.objective }}

## Assessment
{{ filled_sections.assessment }}

## Plan
{{ filled_sections.plan }}
