---
id: progress-note
name: Progress Note
kind: clinical_note
sections:
  - id: subjective
    title: Subjective
    required_fields: ["interval_history"]
    prompt_guidance: >
      Patient's interval history since the last note — symptom changes, sleep,
      pain, appetite, bowel/bladder, mood. Patient's own voice. Do not repeat
      objective measurements here.
  - id: objective
    title: Objective
    required_fields: ["vital_signs", "exam_findings", "today_labs"]
    prompt_guidance: >
      Today's vitals + focused exam + new lab/imaging results. Cite specific
      values from the Observation list only. Note any change vs. yesterday.
  - id: assessment
    title: Assessment
    required_fields: ["active_problems"]
    prompt_guidance: >
      Active problem list with day-by-day reasoning. For each problem, state
      whether the patient is improving, stable, or worsening, and why.
  - id: plan
    title: Plan
    required_fields: ["interventions"]
    prompt_guidance: >
      For each problem in Assessment, today's diagnostic steps, therapeutic
      changes (with dosing), and the criteria for discharge or escalation.
---
# Progress Note

**Patient:** {{ patient.demographics.name[0].given[0] }} {{ patient.demographics.name[0].family }} | **DOB:** {{ patient.demographics.birthDate }} | **Sex:** {{ patient.demographics.gender }}

## Subjective
{{ filled_sections.subjective }}

## Objective
{{ filled_sections.objective }}

## Assessment
{{ filled_sections.assessment }}

## Plan
{{ filled_sections.plan }}
