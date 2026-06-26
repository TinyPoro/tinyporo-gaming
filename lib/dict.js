'use strict';

const fs   = require('fs');
const path = require('path');

const wgWordSet = new Set();
try {
  const dictPath = path.join(__dirname, '..', 'data', 'Viet74K.txt');
  const lines = fs.readFileSync(dictPath, 'utf8').split('\n');
  for (const line of lines) {
    const w = line.trim().toLowerCase();
    const parts = w.split(' ');
    if (parts.length === 2 && !w.includes('-')) wgWordSet.add(w);
  }
  console.log(`📚 Loaded ${wgWordSet.size.toLocaleString()} Vietnamese words from dictionary`);
} catch {
  console.warn('⚠️  Dictionary not found — word validation will use syllable rules only');
}

module.exports = wgWordSet;
