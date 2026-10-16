# OIDC Tester

Desktop app for testing OAuth2/OIDC flows against any identity provider and inspecting the tokens that come back.

## Language

**Claim**:
A name/value pair in a decoded JWT payload.
_Avoid_: Field, attribute

**Raw claim value**:
The claim value exactly as it appears in the payload JSON: strings without quotes, everything else as compact JSON.
_Avoid_: Original value, plain value

**Scope**:
A permission name requested at authorization and echoed in the `scope` or `scp` claim.
_Avoid_: Permission, right
