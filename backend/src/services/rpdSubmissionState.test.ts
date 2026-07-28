import { describe, it, expect } from 'vitest'
import { applyTransition, availableActions } from './rpdSubmissionState'

describe('applyTransition', () => {
  it('draft -> submitted on submit', () => {
    expect(applyTransition('draft', 'submit')).toEqual({ status: 'submitted', returnedByStage: null })
  })

  it('returned -> submitted on resubmit (same action as first submit)', () => {
    expect(applyTransition('returned', 'submit')).toEqual({ status: 'submitted', returnedByStage: null })
  })

  it('submitted -> forwarded on forward (РОП accepts)', () => {
    expect(applyTransition('submitted', 'forward')).toEqual({ status: 'forwarded', returnedByStage: null })
  })

  it('submitted -> returned on return, stamped stage "rop"', () => {
    expect(applyTransition('submitted', 'return')).toEqual({ status: 'returned', returnedByStage: 'rop' })
  })

  it('forwarded -> returned on return, stamped stage "umc"', () => {
    expect(applyTransition('forwarded', 'return')).toEqual({ status: 'returned', returnedByStage: 'umc' })
  })

  it('forwarded -> approved on approve (terminal)', () => {
    expect(applyTransition('forwarded', 'approve')).toEqual({ status: 'approved', returnedByStage: null })
  })

  it('rejects submit from an already-submitted state (no-op resubmit)', () => {
    expect(applyTransition('submitted', 'submit')).toBeNull()
  })

  it('rejects forward from draft — must go through submitted first', () => {
    expect(applyTransition('draft', 'forward')).toBeNull()
  })

  it('rejects approve from submitted — РОП cannot approve without УМЦ', () => {
    expect(applyTransition('submitted', 'approve')).toBeNull()
  })

  it('rejects approve from draft', () => {
    expect(applyTransition('draft', 'approve')).toBeNull()
  })

  it('rejects any action from the terminal approved state', () => {
    expect(applyTransition('approved', 'submit')).toBeNull()
    expect(applyTransition('approved', 'return')).toBeNull()
    expect(applyTransition('approved', 'forward')).toBeNull()
    expect(applyTransition('approved', 'approve')).toBeNull()
  })

  it('rejects return from draft', () => {
    expect(applyTransition('draft', 'return')).toBeNull()
  })
})

describe('availableActions', () => {
  it('draft only accepts submit', () => {
    expect(availableActions('draft')).toEqual(['submit'])
  })

  it('submitted accepts return and forward', () => {
    expect(availableActions('submitted')).toEqual(['return', 'forward'])
  })

  it('returned only accepts resubmit', () => {
    expect(availableActions('returned')).toEqual(['submit'])
  })

  it('forwarded accepts return and approve', () => {
    expect(availableActions('forwarded')).toEqual(['return', 'approve'])
  })

  it('approved (terminal) accepts nothing', () => {
    expect(availableActions('approved')).toEqual([])
  })
})
