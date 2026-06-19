/**
 * Offline SAML verification — exercises the real services/saml.ts without an
 * IdP. Proves the node-saml integration works end to end up to the signature
 * boundary: SP keypair loads, AuthnRequest is built + signed, metadata is
 * well-formed XML, attribute extraction handles the IdP shapes we expect.
 *
 *   npx tsx backend/scripts/verifySaml.ts
 *
 * Reads the generated keys from /tmp/saml_keys.txt (output of
 * generateSamlSpKeypair.ts) so we don't have to touch the real .env.
 */
import { readFileSync } from 'node:fs'

// ── Load generated SP keys into env BEFORE importing the service ──
const keysFile = readFileSync('/tmp/saml_keys.txt', 'utf8')
const pk = keysFile.match(/SAML_SP_PRIVATE_KEY="([^"]*)"/)?.[1]
const cert = keysFile.match(/SAML_SP_CERTIFICATE="([^"]*)"/)?.[1]
if (!pk || !cert) { console.error('could not parse keys'); process.exit(1) }
process.env.SAML_SP_ENTITY_ID  = 'https://ispum.ru/api/sso/sp'
process.env.SAML_SP_PRIVATE_KEY = pk
process.env.SAML_SP_CERTIFICATE = cert
process.env.BACKEND_URL = 'http://localhost:3000'

const {
  buildSamlForInstitution, generateSpMetadata,
  extractAttribute, EMAIL_FALLBACK_ATTRS, NAME_FALLBACK_ATTRS,
  acsUrlForInstitution,
} = await import('../src/services/saml')

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++ }
  else { console.log(`  ✗ ${name} ${detail}`); fail++ }
}

const INST = '11111111-1111-1111-1111-111111111111'

console.log('\n1. SP metadata generation')
const meta = generateSpMetadata(INST)
check('returns XML declaration', meta.startsWith('<?xml'))
check('contains our entity id', meta.includes('https://ispum.ru/api/sso/sp'))
check('ACS URL is institution-scoped', meta.includes(acsUrlForInstitution(INST)))
check('embeds the SP certificate', meta.includes('<ds:X509Certificate>'))
check('declares WantAssertionsSigned', meta.includes('WantAssertionsSigned="true"'))

console.log('\n2. AuthnRequest build + sign (exercises private key)')
// Dummy but well-formed IdP config — entryPoint + a cert (reuse our own,
// only used here to construct the instance; we never validate against it).
const saml = buildSamlForInstitution(INST, {
  saml_enabled:         true,
  saml_idp_entity_id:   'http://localhost:8080/realms/test',
  saml_idp_sso_url:     'http://localhost:8080/realms/test/protocol/saml',
  saml_idp_x509_cert:   cert.replace(/\\n/g, '\n'),
  saml_attribute_email: 'email',
  saml_attribute_name:  'displayName',
  saml_force_sso:       false,
})
const url = await saml.getAuthorizeUrlAsync('/dashboard', undefined, {})
const parsed = new URL(url)
check('redirects to the IdP SSO URL', url.startsWith('http://localhost:8080/realms/test/protocol/saml'))
check('carries a SAMLRequest param', parsed.searchParams.has('SAMLRequest'))
check('AuthnRequest is signed (Signature + SigAlg present)',
  parsed.searchParams.has('Signature') && parsed.searchParams.has('SigAlg'))
check('RelayState round-trips', parsed.searchParams.get('RelayState') === '/dashboard')

console.log('\n3. Attribute extraction (IdP shape variations)')
// Direct configured attribute
check('direct configured email', extractAttribute({ email: 'a@x.ru' }, 'email', EMAIL_FALLBACK_ATTRS) === 'a@x.ru')
// Array-valued (some IdPs wrap in arrays)
check('array-valued email', extractAttribute({ email: ['b@x.ru'] }, 'email', EMAIL_FALLBACK_ATTRS) === 'b@x.ru')
// Friendly fallback when configured name absent
check('falls back to mail', extractAttribute({ mail: 'c@x.ru' }, 'email', EMAIL_FALLBACK_ATTRS) === 'c@x.ru')
// OID-style claim (ADFS / Shibboleth)
check('OID claim fallback',
  extractAttribute({ 'urn:oid:0.9.2342.19200300.100.1.3': 'd@x.ru' }, 'email', EMAIL_FALLBACK_ATTRS) === 'd@x.ru')
// Name extraction
check('display name', extractAttribute({ displayName: 'Иван Иванов' }, 'displayName', NAME_FALLBACK_ATTRS) === 'Иван Иванов')
// Missing → null
check('missing returns null', extractAttribute({}, 'email', EMAIL_FALLBACK_ATTRS) === null)
check('undefined attributes → null', extractAttribute(undefined, 'email', EMAIL_FALLBACK_ATTRS) === null)

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
