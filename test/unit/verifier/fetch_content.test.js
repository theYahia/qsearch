// Run: node --test test/unit/verifier/fetch_content.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usableText } from '../../../src/verifier/fetch_content.js'

// The three below are verbatim-shaped samples of what bot-walled sources actually returned on
// 2026-08-04 — each one cleared the old 200-char floor and reached the judge as if it were the
// cited document.
test('navigation chrome is not a readable source', () => {
  const govBanner = ['Federal government websites often end in .gov or .mil. Before sharing sensitive information, make sure you’re on a federal government site.', 'The https:// Español Secondary Menu Report Fraud Submit Public Comments Search the Legal Library']
  assert.equal(usableText(govBanner), false)

  const menu = ['![Graves Dougherty Hearon & Moody]( MENUMENU Practice Areas OVERVIEW Administrative & Regulatory Appellate Law Banking & Finance Bankruptcy & Creditors’ Remedies Civil Litigation Commercial Transactions Construction Law Corporate & Securities Environment & Natural Resources Estate Planning, Probate & Trusts Government Affairs Intellectual Property Internet & Information Technology Labor & Employment Litigation Mediation Real Estate Tax Trial']
  assert.equal(usableText(menu), false)

  assert.equal(usableText([]), false)
  assert.equal(usableText(['too short']), false)
})

test('real prose is readable, however short', () => {
  const short = [
    'The Texas Supreme Court held that an award of stock options to a key employee is reasonably related to an interest worthy of protection.',
    'The court reasoned that the options gave the employee a stake in the company beyond salary alone, which distinguishes them from ordinary compensation.',
    'It therefore reversed the court of appeals and remanded the case for further proceedings consistent with its opinion.'
  ]
  assert.ok(short.join(' ').length < 2000, 'sample must exercise the sentence path, not the length shortcut')
  assert.equal(usableText(short), true)

  // Anything long enough is taken on trust — at 2 000+ characters a menu is no longer the likely
  // explanation, and a sentence test would start rejecting tables, statutes and transcripts.
  assert.equal(usableText([Array(60).fill('Practice Areas Overview Litigation').join(' ')]), true)
})
