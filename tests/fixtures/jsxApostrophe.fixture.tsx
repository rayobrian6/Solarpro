/**
 * tests/fixtures/jsxApostrophe.fixture.tsx
 *
 * NOT A TEST — a specimen. tests/stripSourceIsJsxSafe.test.ts strips this file
 * and asserts what must survive and what must not.
 *
 * It is a miniature of the constructs that made the hand-rolled stripper in
 * tests/support/stripSource.ts blank real code: an apostrophe in JSX text, a
 * double slash in JSX text, a regex literal containing quote characters, and a
 * nested template literal. Each sentinel is named for the question it answers, so
 * a failure says WHICH construct broke rather than "a count changed".
 *
 * 🚨 DO NOT "TIDY" THE PUNCTUATION, AND DO NOT REORDER THE TWO COMPONENTS. The
 * raw apostrophes, the double slash inside the URL and the inner backticks ARE
 * the specimen; escaping them (&apos;, string concatenation) is how this fixture
 * stops testing anything. The JSX panel comes FIRST on purpose: a broken stripper
 * that mis-parses the quote characters further down would otherwise reach the
 * apostrophes with its quote parity already inverted, and could blank the right
 * bytes by accident.
 *
 * STRIP_FIXTURE_BLOCK_COMMENT — prose, must be blanked by BOTH strippers.
 */

import React from 'react';

// STRIP_FIXTURE_LINE_COMMENT — prose, must be blanked by BOTH strippers.

/** Construct 1: apostrophes and a double slash, in JSX TEXT. */
export function StripFixtureApostrophePanel({ owner }: { owner: string }) {
  return (
    <section data-fixture="STRIP_FIXTURE_ATTRIBUTE_STRING">
      {/* STRIP_FIXTURE_JSX_EXPRESSION_COMMENT — prose, must be blanked by BOTH. */}
      <p>See https://example.test/a//b for STRIP_FIXTURE_AFTER_DOUBLE_SLASH in JSX text.</p>
      <p>This is {owner}'s roof, and the array sits on the south face of it.</p>
      <StripFixtureChild dataSentinelProp={41 + 1} />
      <p>STRIP_FIXTURE_JSX_PROSE with no punctuation of any kind in this sentence</p>
      <p>It's the only face that isn't shaded.</p>
    </section>
  );
}

/** Constructs 2 and 3: a quote inside a regex, and a template inside a template. */
export function StripFixtureLiteralPanel({ owner }: { owner: string }) {
  const quoted = 'STRIP_FIXTURE_STRING_BODY';
  const quoteEater = /['"]/g;
  const STRIP_FIXTURE_AFTER_REGEX = quoted.replace(quoteEater, '');
  const nested = `head ${owner ? `inner ${quoted}` : ''} STRIP_FIXTURE_TEMPLATE_TEXT`;
  const STRIP_FIXTURE_AFTER_NESTED_TEMPLATE = nested.length + STRIP_FIXTURE_AFTER_REGEX.length;
  return <StripFixtureChild dataSentinelProp={STRIP_FIXTURE_AFTER_NESTED_TEMPLATE} />;
}

function StripFixtureChild({ dataSentinelProp }: { dataSentinelProp: number }) {
  return <span>{dataSentinelProp}</span>;
}
