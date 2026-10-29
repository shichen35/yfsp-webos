import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initFocusEngine, openFocusFrame, getActiveLayer } from './useFocus.js'

test('closing a frame out of order removes that frame, not the top one', () => {
  globalThis.window = new EventTarget()
  initFocusEngine()
  const backs = []
  const closeA = openFocusFrame({ layer: 'a', onBack: () => backs.push('a') })
  const closeB = openFocusFrame({ layer: 'b', onBack: () => backs.push('b') })

  closeA()
  assert.equal(getActiveLayer(), 'b')
  const back = new Event('keydown')
  back.keyCode = 461
  window.dispatchEvent(back)
  assert.deepEqual(backs, ['b'])

  closeB()
  assert.equal(getActiveLayer(), 'home')
})
