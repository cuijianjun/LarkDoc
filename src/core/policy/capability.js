import { DEFAULT_CAPABILITIES, projectCapabilitiesForState } from '../../providers/authorization'

export const CAPABILITY_TREATMENTS = Object.freeze({
  allow: 'allow',
  gray: 'gray',
  downgrade: 'downgrade',
  replace: 'replace',
})

export const CAPABILITY_UI = Object.freeze({
  canView: CAPABILITY_TREATMENTS.replace,
  canEdit: CAPABILITY_TREATMENTS.gray,
  canComment: CAPABILITY_TREATMENTS.gray,
  canResolveComment: CAPABILITY_TREATMENTS.gray,
  canCreateVersion: CAPABILITY_TREATMENTS.gray,
  canRestoreVersion: CAPABILITY_TREATMENTS.gray,
  canExport: CAPABILITY_TREATMENTS.gray,
  canManagePermission: CAPABILITY_TREATMENTS.downgrade,
})

export const CAPABILITY_GRAY_STYLE = Object.freeze({
  color: 'var(--ld-share-text-disabled)',
  cursor: 'not-allowed',
  pointerEvents: 'auto',
})

export function readCapability(session, key) {
  if (!session || typeof session.can !== 'function') return true
  return session.can(key) !== false
}

export function capabilityTreatment(key) {
  return CAPABILITY_UI[key] || CAPABILITY_TREATMENTS.allow
}

const STATE_CAPABILITY_KEYS = Object.freeze({
  canView: 'visible',
  canEdit: 'edit',
  canComment: 'comment',
  canResolveComment: 'comment',
  canCreateVersion: 'edit',
  canRestoreVersion: 'restore',
  canExport: 'export',
  canManagePermission: 'edit',
})

export function projectCapabilityUi(session, key, stateCapabilities = null) {
  const state = stateCapabilities || {}
  const sessionAllowed = readCapability(session, key)
  const stateKey = STATE_CAPABILITY_KEYS[key]
  const stateAllowed = stateKey && state[stateKey] !== undefined ? state[stateKey] !== false : true
  const allowed = sessionAllowed && stateAllowed
  const treatment = allowed ? CAPABILITY_TREATMENTS.allow : capabilityTreatment(key)
  const gray = treatment === CAPABILITY_TREATMENTS.gray
  return {
    key,
    allowed,
    treatment,
    mounted: treatment !== CAPABILITY_TREATMENTS.replace,
    hidden: false,
    gray,
    downgraded: treatment === CAPABILITY_TREATMENTS.downgrade,
    style: gray ? CAPABILITY_GRAY_STYLE : null,
  }
}

export function projectCapabilityUiStates(session, asyncState = null) {
  const normalizedState = asyncState && typeof asyncState === 'object' ? asyncState.state : asyncState
  const stateCapabilities = normalizedState ? projectCapabilitiesForState(normalizedState) : null
  const result = {}
  Object.keys(DEFAULT_CAPABILITIES).forEach((key) => {
    result[key] = projectCapabilityUi(session, key, stateCapabilities)
  })
  return result
}
