---
id: discharge-summary
name: Discharge Summary
kind: clinical_note
sections:
  - id: hpi
    title: History of Present Illness
    required_fields: ["admission_reason", "admission_date"]
    prompt_guidance: >
      Admission presentation and pertinent history leading to hospitalization.
      Reference the admission note if present in priorNotes.
  - id: hospital_course
    title: Hospital Course
    required_fields: ["problems_addressed"]
    prompt_guidance: >
      Day-by-day or problem-by-problem summary of what happened during
      admission. Include key findings, interventions, and response.
  - id: discharge_medications
    title: Discharge Medications
    required_fields: ["discharge_med_list"]
    prompt_guidance: >
      Full medication list at discharge. Note changes from admission meds
      (new, stopped, dose-adjusted). Include dosing, route, frequency.
  - id: follow_up
    title: Follow-up
    required_fields: ["appointments", "return_precautions"]
    prompt_guidance: >
      Scheduled follow-up appointments, pending labs/studies, red-flag
      symptoms warranting return, contact information.
---
# Discharge Summary

**Patient:** {{ patient.demographics.name[0].given[0] }} {{ patient.demographics.name[0].family }} | **DOB:** {{ patient.demographics.birthDate }}

## History of Present Illness
{{ filled_sections.hpi }}

## Hospital Course
{{ filled_sections.hospital_course }}

## Discharge Medications
{{ filled_sections.discharge_medications }}

## Follow-up
{{ filled_sections.follow_up }}
