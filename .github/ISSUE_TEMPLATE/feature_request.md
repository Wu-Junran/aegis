---
name: Feature request
about: Propose a change or new capability for Aegis.
title: "[feature] "
labels: enhancement
---

## Problem / use case

<!-- What is the researcher or clinician trying to do? Why does the
     current behavior block that? -->

## Proposed change

<!-- Concrete description of the new behavior. If this touches PHI
     handling, audit logging, the export gate, providers, or FHIR
     ingestion, please describe the safety impact. -->

## Alternatives considered

## Safety implications

<!-- Does this weaken any strict-mode invariant (PHI redaction before
     LLM, audit redaction, export attestation, file-mode 0600)? If yes,
     this likely needs to be opt-in and gated by phiMode. -->

## Out of scope (not in this request)

- [ ] Real-PHI deployment claims, FDA/HIPAA certification language.
- [ ] EMR write-back (deferred per project status).
