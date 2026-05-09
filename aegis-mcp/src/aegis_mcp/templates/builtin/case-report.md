---
id: case-report
name: Case Report
kind: report
sections:
  - id: introduction
    title: Introduction
    required_fields: ["clinical_question"]
    prompt_guidance: >
      One paragraph framing the clinical question this case illustrates. Cite
      one or two anchoring references if relevant (placeholder citations OK
      in the draft — author resolves them in editing).
  - id: presentation
    title: Case Presentation
    required_fields: ["demographics_summary", "presenting_complaint"]
    prompt_guidance: >
      Patient demographics (de-identified), presenting complaint, relevant
      history. Write as a third-person clinical narrative suitable for
      publication. Do not include direct identifiers from the source bundle.
  - id: investigations
    title: Investigations
    required_fields: ["key_findings"]
    prompt_guidance: >
      Diagnostic workup — labs, imaging, procedures — with values from the
      bundle's Observation/DiagnosticReport list. Highlight findings that
      drove the decision-making.
  - id: management
    title: Management
    required_fields: ["interventions"]
    prompt_guidance: >
      Therapeutic course: medications (with dosing), procedures, escalations.
      Reference the bundle's MedicationRequest / Procedure resources.
  - id: outcome
    title: Outcome and Follow-up
    required_fields: ["disposition"]
    prompt_guidance: >
      Discharge disposition, recovery trajectory, follow-up plan. Note any
      complications and their resolution.
  - id: discussion
    title: Discussion
    required_fields: ["learning_points"]
    prompt_guidance: >
      Two to three learning points the case illustrates. Connect back to the
      clinical question framed in the Introduction. Note limitations
      (n=1, retrospective) explicitly.
---
# Case Report

## Introduction
{{ filled_sections.introduction }}

## Case Presentation
{{ filled_sections.presentation }}

## Investigations
{{ filled_sections.investigations }}

## Management
{{ filled_sections.management }}

## Outcome and Follow-up
{{ filled_sections.outcome }}

## Discussion
{{ filled_sections.discussion }}
