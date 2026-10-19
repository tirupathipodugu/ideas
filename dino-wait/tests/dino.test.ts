import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// Stand-ins for what the engine does beneath the plugin.
const engine = (on: On) => {
  const saved: unknown[] = []
  on('store.set', ($, e) => (saved.push(e), { value: undefined }) as never)
  on('store.get', () => undefined as never)
  on('turn.start', ($, e) => e as never)
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  on('ui.blit', () => ({ value: {} }) as never)
  // The engine's own band: nothing to show.
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  // The prompt box: the edit lands as typed.
  on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }) as never)

  return { saved, clock: mock.clock(on) }
}

const BAND = {
  plugin: 'dino-wait',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 30, bodyColumns: 120, scroll: { bodyRows: 30 } } as never,
} as const

// One key typed into the prompt box holding `text`.
const type = ($: any, key: string, text = '', name = key) =>
  $.prompt.edit({ origin: { kind: 'composer' }, key: { key: name }, text, cursor: text.length, start: text.length, end: text.length, inputText: key })

const turn = { text: 'fix the bug', turnId: 't1' }
const done = { answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never

test('the game shows above the prompt while Claude works, not before', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()

  await $.turn.start(turn)
  expect(await ui.find({ type: 'Raster' })).toMatchObject({ props: { columns: 120 } })
  expect(await ui.find({ text: /Claude is working/ })).toBeDefined()

  // Claude finishes with no run going: the band goes back to the prompt.
  await $.turn.complete(done)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('a subagent turn leaves the band alone', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)

  await $.turn.start({ text: 'sub', turnId: 't2', agentId: 'a1' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('Space in the empty prompt starts a run without typing, and the score is kept', async ($, on) => {
  const { saved, clock } = engine(on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  expect(await ui.find({ text: /Press Space to start/ })).toBeDefined()

  expect(await type($, ' ')).toMatchObject({ text: '' })
  expect(await ui.find({ text: /Space or W jump/ })).toBeDefined()

  // Never jumping, the dino meets the first cactus within a few seconds.
  for (let i = 0; i < 400 && !saved.length; i++) await clock.advance(33)
  expect(await ui.find({ text: /Game over/ })).toBeDefined()
  expect(saved).toEqual([expect.objectContaining({ key: 'best', value: expect.any(Number) })])
  await ui.unmount()
})

test('writing a message still works while the game shows', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  await type($, ' ')

  // A key that is not the game's types as usual, and then the box is the person's.
  expect(await type($, 'h')).toMatchObject({ text: 'h' })
  expect(await type($, ' ', 'hi')).toMatchObject({ text: 'hi ' })
  expect(await type($, 's', 'hi ')).toMatchObject({ text: 'hi s' })
  await ui.unmount()
})

test('with the game hidden, Space types into the prompt', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)
  expect(await type($, ' ')).toMatchObject({ text: ' ' })
  await ui.unmount()
})

// Reported: Space did nothing. Terminals may name the key 'space' rather than send ' '.
test('Space starts the run when the terminal names the key "space"', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  expect(await ui.find({ text: /Press Space to start/ })).toBeDefined()

  expect(await type($, ' ', '', 'space')).toMatchObject({ text: '' })
  expect(await ui.find({ text: /Space or W jump/ })).toBeDefined()
  await ui.unmount()
})

test('a prompt holding only spaces still counts as empty', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  expect(await ui.find({ text: /Press Space to start/ })).toBeDefined()

  expect(await type($, ' ', '  ')).toMatchObject({ text: '  ' })
  expect(await ui.find({ text: /Space or W jump/ })).toBeDefined()
  await ui.unmount()
})

// Reported: the game did not fill the width.
test('the game fills a wide band', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...BAND, props: { hasSurvey: false, isWorking: true, maxRows: 30, bodyColumns: 230, scroll: { bodyRows: 30 } } as never })
  await $.turn.start(turn)
  expect(await ui.find({ type: 'Raster' })).toMatchObject({ props: { columns: 230 } })
  await ui.unmount()
})
