# SAML SSO — local testing with Keycloak

This walks through testing the full SAML login flow end-to-end on your machine,
using Keycloak as a stand-in for a university IdP (ADFS, Keycloak, ALD Pro all
behave the same way from our side).

## Prerequisites

- Backend running on `http://localhost:3000`, frontend on `http://localhost:5173`
- `SAML_SP_*` env vars set (run `npx tsx backend/scripts/generateSamlSpKeypair.ts`,
  paste the output into `.env`)
- Migration 041 applied (`npm run migrate --workspace=backend`)
- Docker installed

## 1. Start Keycloak

```bash
docker compose -f docker-compose.keycloak.yml up -d
```

Wait ~20s, then open http://localhost:8080 and log in as `admin` / `admin`.

## 2. Create a realm

- Top-left realm dropdown → **Create realm**
- Realm name: `test-university` → **Create**

## 3. Create a test user

- **Users** → **Add user**
  - Username: `prof.ivanov`
  - Email: `ivanov@test-university.ru`
  - First name / Last name: fill in (these populate `displayName`)
  - Email verified: **On**
  - **Create**
- **Credentials** tab → **Set password**
  - Password: `test1234`, Temporary: **Off**

## 4. Register ИСПУМ as a SAML client

- **Clients** → **Create client**
  - Client type: **SAML**
  - Client ID: must match our SP Entity ID exactly — `https://ispum.ru/api/sso/sp`
    (or whatever `SAML_SP_ENTITY_ID` is in your `.env`)
  - **Next**
- On the settings page:
  - **Valid redirect URIs**: `http://localhost:3000/api/sso/*`
  - **Master SAML Processing URL** (ACS):
    `http://localhost:3000/api/sso/<INSTITUTION_ID>/acs`
    (fill in the real institution id from step 6 — come back and edit this)
  - **Name ID format**: `email`
  - **Force POST binding**: On
  - **Sign assertions**: On
  - Save

### Map the email + name attributes

Keycloak doesn't send user attributes by default — add mappers:

- **Client scopes** → click `https://ispum.ru/api/sso/sp-dedicated`
- **Add mapper** → **By configuration** → **User Property**
  - Name: `email`
  - Property: `email`
  - SAML Attribute Name: `email`
  - SAML Attribute NameFormat: `Basic`
- Add another **User Property** mapper:
  - Name: `displayName`
  - Property: `username` (or use **User's full name** mapper)
  - SAML Attribute Name: `displayName`
  - SAML Attribute NameFormat: `Basic`

## 5. Get Keycloak's IdP metadata

Three values we need for the ИСПУМ admin panel:

- **IdP Entity ID**:
  `http://localhost:8080/realms/test-university`
- **IdP SSO URL**:
  `http://localhost:8080/realms/test-university/protocol/saml`
- **IdP X.509 certificate**:
  **Realm settings** → **Keys** → row `RS256` (SIG) → **Certificate** → copy the
  Base64 blob, then wrap it as PEM:
  ```
  -----BEGIN CERTIFICATE-----
  <paste blob here>
  -----END CERTIFICATE-----
  ```

You can also fetch the full IdP metadata XML at:
`http://localhost:8080/realms/test-university/protocol/saml/descriptor`

## 6. Configure the institution in ИСПУМ

- Log in to ИСПУМ as a `platform_admin`
- **Admin → Организации** → create an institution:
  - Name: `Test University`
  - **Домен авто-входа**: `test-university.ru` (must match the user's email domain)
- Note the institution's **id** (visible in the SSO panel's ACS URL).
- Go back to Keycloak step 4 and put the real institution id into the **Master
  SAML Processing URL** / ACS redirect.
- Click **Настроить** (SSO) on the institution row and fill in:
  - Enable SSO: **On**
  - IdP Entity ID / IdP SSO URL / Certificate from step 5
  - Email attribute: `email`, Name attribute: `displayName`
  - **Сохранить**

## 7. Test the flow

- Open an incognito window → http://localhost:5173/login
- Enter `ivanov@test-university.ru` → **Продолжить**
- You should be redirected to Keycloak → sign in as `prof.ivanov` / `test1234`
- Keycloak posts the assertion back → you land on `/sso/callback` → dashboard
- Verify in the DB: a `teachers` row now exists for `ivanov@test-university.ru`
  with `institution_id` set, `saml_provisioned_at` stamped, and `saml_subject`
  populated.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `SAML_NOT_CONFIGURED` | SSO not enabled, or one of the three IdP fields blank |
| `SAML_VALIDATION_FAILED` | Wrong IdP certificate, or clock skew between containers |
| `SAML_NO_EMAIL` | Attribute mapper missing/misnamed — check step 4 mappers |
| Redirect loops back to login | Email domain on the institution doesn't match the user's email |
| Keycloak "Invalid requester" | Client ID ≠ our SP Entity ID, or redirect URI not whitelisted |

## Teardown

```bash
docker compose -f docker-compose.keycloak.yml down
```
