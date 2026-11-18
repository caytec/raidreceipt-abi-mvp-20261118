"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");

function calculate(input) {
  var totalCost =
    input.loadoutCost +
    input.ammoCost +
    input.consumableCost +
    input.entryCost;

  var netResult = input.extractedLoot - totalCost;
  var multiplier = totalCost > 0 ? input.extractedLoot / totalCost : null;
  var profitable = input.extractedLoot >= totalCost;
  var grade = "F";

  if (input.survived && multiplier !== null && netResult >= totalCost * 2) {
    grade = "S";
  } else if (input.survived && netResult >= totalCost) {
    grade = "A";
  } else if (input.survived && profitable && netResult > 0) {
    grade = "B";
  } else if (input.survived && Math.abs(netResult) <= Math.max(1, totalCost * 0.05)) {
    grade = "C";
  } else if (!input.survived && (input.extractedLoot > 0 || input.kills >= 3 || input.revives >= 2)) {
    grade = "D";
  }

  return {
    totalCost: totalCost,
    netResult: netResult,
    multiplier: multiplier,
    profitable: profitable,
    grade: grade
  };
}

function base() {
  return {
    loadoutCost: 100,
    ammoCost: 0,
    consumableCost: 0,
    entryCost: 0,
    extractedLoot: 0,
    survived: true,
    kills: 0,
    assists: 0,
    revives: 0
  };
}

test("calculates a profitable survived raid", function () {
  var input = base();
  input.extractedLoot = 300;

  var result = calculate(input);

  assert.equal(result.totalCost, 100);
  assert.equal(result.netResult, 200);
  assert.equal(result.multiplier, 3);
  assert.equal(result.profitable, true);
  assert.equal(result.grade, "S");
});

test("calculates exact break-even", function () {
  var input = base();
  input.extractedLoot = 100;

  var result = calculate(input);

  assert.equal(result.netResult, 0);
  assert.equal(result.profitable, true);
  assert.equal(result.grade, "C");
});

test("handles zero total cost without infinity", function () {
  var input = base();
  input.loadoutCost = 0;
  input.extractedLoot = 100;

  var result = calculate(input);

  assert.equal(result.multiplier, null);
  assert.equal(result.netResult, 100);
});

test("a death with meaningful combat can receive D", function () {
  var input = base();
  input.survived = false;
  input.kills = 3;

  var result = calculate(input);

  assert.equal(result.grade, "D");
});

test("a death with no value and no stats receives F", function () {
  var input = base();
  input.survived = false;

  var result = calculate(input);

  assert.equal(result.grade, "F");
});

test("negative result remains a loss", function () {
  var input = base();
  input.extractedLoot = 20;

  var result = calculate(input);

  assert.equal(result.netResult, -80);
  assert.equal(result.profitable, false);
});
