---
name: security-audit
version: 1.0.0
description: OWASP Top 10 security checklist
triggers:
  - "security"
  - "audit"
  - "vulnerability"
  - "owasp"
agents:
  - security
---

# Security Audit Checklist

OWASP Top 10 vulnerability review.

## A01: Broken Access Control

- [ ] Authorization checks on all endpoints
- [ ] No IDOR vulnerabilities
- [ ] Role-based access enforced

## A02: Cryptographic Failures

- [ ] Secrets in environment variables
- [ ] HTTPS enforced
- [ ] Strong encryption algorithms

## A03: Injection

- [ ] Parameterized SQL queries
- [ ] Input sanitized
- [ ] No command injection

## A04: Insecure Design

- [ ] Threat modeling done
- [ ] Security architecture reviewed

## A05: Security Misconfiguration

- [ ] Default credentials removed
- [ ] Error messages sanitized
- [ ] Debug mode disabled

## A06: Vulnerable Components

- [ ] Dependencies audited
- [ ] No known CVEs

## A07: Auth Failures

- [ ] Strong password policy
- [ ] Session management secure
- [ ] MFA available

## A08: Data Integrity

- [ ] Input validated
- [ ] Integrity checks on critical data

## A09: Logging Failures

- [ ] Security events logged
- [ ] Logs don't contain secrets

## A10: SSRF

- [ ] URL validation on external requests
- [ ] No arbitrary URL acceptance
