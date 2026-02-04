# Security Audit: gong-mcp

**Original Repository:** https://github.com/kenazk/gong-mcp  
**Audit Date:** February 4, 2026  
**Risk Level:** Medium

---

## Executive Summary

This security audit identifies several vulnerabilities in the original gong-mcp repository and provides recommendations for hardening the MCP server.

---

## Vulnerabilities Found

### 1. 🔴 No Input Validation (Medium Risk)
**Location:** `listCalls()` and `retrieveTranscripts()` methods

The original code passes user-supplied parameters directly to the Gong API without validation:
- Malformed dates could cause unexpected behavior
- Excessively large `callIds` arrays could cause DoS
- No character validation on call IDs

**Recommendation:** Add strict input validation with regex patterns and array length limits.

---

### 2. 🔴 No Request Timeouts (Medium Risk)
**Location:** `axios` requests

HTTP requests have no timeout configuration. A slow API could hang the server indefinitely.

**Recommendation:** Add configurable timeout (default: 30 seconds).

---

### 3. 🟡 Verbose Error Messages (Low-Medium Risk)
**Location:** Error handlers

Full error messages could leak internal API details or credential validation errors.

**Recommendation:** Sanitize errors to user-friendly messages.

---

### 4. 🟡 No Rate Limiting (Low-Medium Risk)
**Location:** All API methods

No protection against rapid calls that could exhaust API limits or enable enumeration.

**Recommendation:** Add configurable rate limiting (default: 10 req/min).

---

## Recommended Security Improvements

| Feature | Current | Recommended |
|---------|---------|-------------|
| Input validation | ❌ None | ✅ Strict regex + length limits |
| Request timeouts | ❌ None | ✅ 30s default, configurable |
| Rate limiting | ❌ None | ✅ 10 req/min default |
| Error sanitization | ❌ Verbose | ✅ Safe messages only |

---

## Before Deployment Checklist

- [ ] Rotate credentials if previously exposed
- [ ] Review Gong API permissions (use minimum scopes)
- [ ] Enable Gong audit logs
- [ ] Set up monitoring for unusual API patterns
- [ ] Consider IP allowlisting in Gong

---

## Environment Variables

```bash
GONG_ACCESS_KEY=your_key
GONG_ACCESS_SECRET=your_secret
GONG_RATE_LIMIT=10          # Optional: requests per minute
GONG_REQUEST_TIMEOUT=30000  # Optional: timeout in ms
```
