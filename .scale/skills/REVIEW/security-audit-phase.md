# skill: security-audit-phase

## Phase
REVIEW

## Purpose
OWASP Top 10 security vulnerability scan.

## Triggers
- Command: `scale review --security`
- Keywords: security, audit, owasp

## Checklist

1. **Injection** (A01)
   - SQL injection check
   - Command injection check
   - XSS validation

2. **Broken Auth** (A02)
   - Session management
   - Password storage

3. **Sensitive Data** (A03)
   - Encryption at rest
   - Encryption in transit

4. **XXE** (A04)
   - XML parser config

5. **Broken Access** (A05)
   - Authorization checks

6. **Misconfiguration** (A06)
   - Default credentials
   - Debug mode off

7. **XSS** (A07)
   - Input sanitization
   - Output encoding

8. **Deserialization** (A08)
   - Safe deserialization

9. **Vulnerable Components** (A09)
   - Dependency audit

10. **Logging** (A10)
   - Sensitive data not logged
