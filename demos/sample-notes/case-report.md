# Case Report Draft

Synthetic demo output. Not for clinical use.

## Introduction

This synthetic case illustrates how Aegis can convert a structured FHIR bundle into a sectioned research draft while preserving a review gate before export. The example is intentionally sparse so release reviewers can see how the system handles missing clinical detail without treating absence as evidence.

## Case Presentation

A de-identified adult male has a structured history of congestive heart failure. The medication list includes lisinopril 10 mg daily, and the allergy list includes penicillin. The minimal fixture does not include a current chief complaint, physical exam, or admission narrative.

## Investigations

No visit-specific diagnostic reports or laboratory values are available in the minimal synthetic fixture. A reviewer would need current renal function, electrolytes, volume-status findings, and any relevant imaging before using this draft for clinical reasoning.

## Management

The structured medication list includes lisinopril 10 mg daily. No procedures, medication changes, escalation events, or discharge orders are available in the fixture.

## Outcome and Follow-up

No outcome or follow-up resource is included in the minimal fixture. The draft therefore records that follow-up status is unknown rather than fabricating a disposition.

## Discussion

This case demonstrates three release-relevant behaviors: section-aware drafting, explicit handling of missing data, and export review before writing output to disk. Its limitations are substantial: the input is synthetic, single-case, sparse, and not suitable for clinical generalization.
