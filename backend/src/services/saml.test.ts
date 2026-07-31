import { describe, it, expect } from 'vitest'
import { extractAttribute, EMAIL_FALLBACK_ATTRS, NAME_FALLBACK_ATTRS } from './saml'
import { isSamlConfigComplete } from '../db/queries/institutions'

describe('extractAttribute', () => {
  it('reads the configured attribute name directly when present', () => {
    const v = extractAttribute({ mail: 'teacher@university.ru' }, 'mail', EMAIL_FALLBACK_ATTRS)
    expect(v).toBe('teacher@university.ru')
  })

  it('falls back through the fallback list when the configured name is absent', () => {
    const v = extractAttribute(
      { 'urn:oid:0.9.2342.19200300.100.1.3': 'teacher@university.ru' },
      'email', EMAIL_FALLBACK_ATTRS
    )
    expect(v).toBe('teacher@university.ru')
  })

  it('takes the first element when the attribute arrives as an array (multi-valued SAML attribute)', () => {
    const v = extractAttribute({ mail: ['teacher@university.ru', 'alias@university.ru'] }, 'mail', EMAIL_FALLBACK_ATTRS)
    expect(v).toBe('teacher@university.ru')
  })

  it('trims whitespace', () => {
    const v = extractAttribute({ mail: '  teacher@university.ru  ' }, 'mail', EMAIL_FALLBACK_ATTRS)
    expect(v).toBe('teacher@university.ru')
  })

  it('returns null when neither the configured name nor any fallback matches', () => {
    const v = extractAttribute({ someOtherAttr: 'x' }, 'mail', EMAIL_FALLBACK_ATTRS)
    expect(v).toBeNull()
  })

  it('returns null for undefined attributes', () => {
    expect(extractAttribute(undefined, 'mail', EMAIL_FALLBACK_ATTRS)).toBeNull()
  })

  it('ignores a blank string value and keeps looking at fallbacks', () => {
    const v = extractAttribute({ mail: '   ', displayName: 'Teacher' }, 'mail', ['displayName', ...NAME_FALLBACK_ATTRS])
    expect(v).toBe('Teacher')
  })
})

describe('isSamlConfigComplete', () => {
  const base = {
    saml_enabled: true,
    saml_idp_entity_id: 'https://idp.university.ru/metadata',
    saml_idp_sso_url: 'https://idp.university.ru/sso',
    saml_idp_x509_cert: '-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----',
    saml_attribute_email: 'email',
    saml_attribute_name: 'displayName',
    saml_force_sso: false,
  }

  it('is complete when enabled and all three IdP fields are set', () => {
    expect(isSamlConfigComplete(base)).toBe(true)
  })

  it('is incomplete when saml_enabled is false, even with every IdP field set', () => {
    expect(isSamlConfigComplete({ ...base, saml_enabled: false })).toBe(false)
  })

  it.each(['saml_idp_entity_id', 'saml_idp_sso_url', 'saml_idp_x509_cert'] as const)(
    'is incomplete when %s is null',
    (field) => {
      expect(isSamlConfigComplete({ ...base, [field]: null })).toBe(false)
    }
  )
})
