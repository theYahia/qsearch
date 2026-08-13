// Structured payloads inside Brave LLM Context snippets.
// Fixtures below are real shapes taken from saved responses under _tmp_med2 / research/,
// not invented ones — the parser has to survive what Brave actually sends.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseStructured, renderStructured, flattenStructured, structuredDates, snippetToText
} from '../../../src/clean/structured.js'

const TABLE = JSON.stringify({
  title: 'Ограничения и запреты для самозанятых в 2025 году — Контур.Эльба',
  table: [
    { 'Как нельзя': 'Закупать чашки и перепродавать.', 'Почему нельзя': 'Перепродажа чужих товаров на НПД запрещена.', 'Как можно': 'Покупать посуду и расписывать её.' },
    { 'Как нельзя': 'Продавать домашние йогурты.', 'Почему нельзя': 'Молочные продукты подлежат маркировке.', 'Как можно': 'Продавать заготовки из ягод.' }
  ]
})

const FAQ = JSON.stringify({
  mainEntity: [
    { name: 'Может ли самозанятый заключить агентский договор?', acceptedAnswer: { text: 'Да, но с ограничениями.' } },
    { name: 'В чем разница с договором оказания услуг?', acceptedAnswer: { text: 'По договору услуг выполняется конкретная работа.' } }
  ]
})

const ARTICLE = JSON.stringify({
  headline: 'Как оплатить DeepSeek из России в 2026 — Сервисы на vc.ru',
  datePublished: '2026-06-26T14:05:40.000Z',
  dateModified: '2026-06-28T09:00:00.000Z',
  inLanguage: 'ru',
  text: 'Проще всего пополнить API или провести платеж через посредника.'
})

const GRAPH = JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, JSON.parse(ARTICLE)] })

describe('parseStructured — detection', () => {
  test('prose is not structured', () => {
    assert.equal(parseStructured('Плательщик НПД не может зарабатывать больше 2,4 млн рублей.'), null)
  })

  test('JSON-like but unparseable does not throw and is not structured', () => {
    // 179 of these appeared in a 1200-pair sample; a throw here would kill a sweep.
    assert.equal(parseStructured('{"title": "оборванный'), null)
    assert.equal(parseStructured('{'), null)
    assert.equal(parseStructured('[1,2,'), null)
  })

  test('empty and non-string input is safe', () => {
    for (const x of ['', '   ', null, undefined, 42, {}]) assert.equal(parseStructured(x), null)
  })

  test('recognises the four real shapes', () => {
    assert.equal(parseStructured(TABLE).kind, 'table')
    assert.equal(parseStructured(FAQ).kind, 'faq')
    assert.equal(parseStructured(ARTICLE).kind, 'article')
    assert.equal(parseStructured(GRAPH).kind, 'article') // unwrapped from @graph
  })

  test('a JSON object with none of the markers is left alone', () => {
    assert.equal(parseStructured('{"foo":"bar"}'), null)
  })
})

describe('structuredDates — the freshness signal', () => {
  test('extracts publication dates, trimmed to a day', () => {
    assert.deepEqual(structuredDates(parseStructured(ARTICLE)), { published: '2026-06-26', modified: '2026-06-28' })
  })

  test('null when the payload has no dates', () => {
    assert.equal(structuredDates(parseStructured(TABLE)), null)
    assert.equal(structuredDates(null), null)
  })
})

describe('renderStructured — markdown', () => {
  test('table renders as a markdown table with all columns', () => {
    const md = renderStructured(parseStructured(TABLE))
    assert.match(md, /\| Как нельзя \| Почему нельзя \| Как можно \|/)
    assert.match(md, /\|---\|---\|---\|/)
    assert.match(md, /Перепродажа чужих товаров/)
  })

  test('FAQ renders question and answer', () => {
    const md = renderStructured(parseStructured(FAQ))
    assert.match(md, /агентский договор\?/)
    assert.match(md, /Да, но с ограничениями/)
  })

  test('article surfaces the dates a reader would otherwise never see', () => {
    const md = renderStructured(parseStructured(ARTICLE))
    assert.match(md, /published 2026-06-26/)
    assert.match(md, /updated 2026-06-28/)
  })

  test('pipes inside cells are escaped so the table cannot break', () => {
    const md = renderStructured(parseStructured(JSON.stringify({ table: [{ a: 'x|y' }] })))
    assert.match(md, /x\\\|y/)
  })

  test('returns null when there is no structure worth rendering', () => {
    assert.equal(renderStructured(null), null)
    assert.equal(renderStructured(parseStructured(JSON.stringify({ table: [] }))), null)
  })
})

describe('flattenStructured — corpus text', () => {
  test('table keeps both keys and values searchable', () => {
    const txt = flattenStructured(parseStructured(TABLE))
    assert.match(txt, /Как нельзя: Закупать чашки/)
    assert.match(txt, /Перепродажа чужих товаров на НПД запрещена/)
    assert.ok(!txt.includes('|'), 'corpus text must carry no markdown pipes')
  })

  test('FAQ keeps the question attached to its answer', () => {
    const txt = flattenStructured(parseStructured(FAQ))
    assert.match(txt, /агентский договор\? — Да, но с ограничениями/)
  })

  test('article keeps body and publication date', () => {
    const txt = flattenStructured(parseStructured(ARTICLE))
    assert.match(txt, /published 2026-06-26/)
    assert.match(txt, /через посредника/)
  })

  test('empty input yields empty string, never a crash', () => {
    assert.equal(flattenStructured(null), '')
  })
})

describe('snippetToText — the safe default for indexing', () => {
  test('prose passes through byte-identical', () => {
    const prose = 'Лимит дохода для самозанятых в 2026 году равен 2,4 млн рублей.'
    assert.equal(snippetToText(prose), prose)
  })

  test('structured payload becomes its flattened content, not raw JSON', () => {
    const out = snippetToText(TABLE)
    assert.ok(!out.trimStart().startsWith('{'), 'raw JSON must not reach the index')
    assert.match(out, /Перепродажа чужих товаров/)
  })

  test('a recognised payload we cannot flatten is kept rather than dropped', () => {
    // Marker present, nothing extractable — better indexed verbatim than lost.
    const odd = JSON.stringify({ table: [{}] })
    assert.ok(snippetToText(odd).length > 0)
  })

  test('unparseable JSON-like text is preserved verbatim', () => {
    const broken = '{"title": "оборван'
    assert.equal(snippetToText(broken), broken)
  })
})
