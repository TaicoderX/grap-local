import { describe, expect, it } from 'vitest';

import { codeAnalyzer } from '../src/modules/symbols/code-analyzer.js';
import { scanRepository } from '../src/modules/indexing/scanner.js';
import { sampleRepoFixtureRoot } from './test-helpers.js';

describe('codeAnalyzer', () => {
  it('extracts symbols, imports, and basic call edges', async () => {
    const scanResult = await scanRepository(sampleRepoFixtureRoot);
    const analysisResult = codeAnalyzer.analyzeRepository({
      repoRoot: sampleRepoFixtureRoot,
      allFiles: scanResult.files.map((file) => file.absolutePath),
      targetFiles: scanResult.files.map((file) => file.absolutePath)
    });

    const indexAnalysis = analysisResult.analyses.find((analysis) => analysis.relativePath === 'src/index.ts');
    const utilsAnalysis = analysisResult.analyses.find((analysis) => analysis.relativePath === 'src/utils.ts');
    const edgeCasesAnalysis = analysisResult.analyses.find(
      (analysis) => analysis.relativePath === 'src/edge-cases.ts'
    );

    expect(indexAnalysis?.imports).toEqual(['./utils']);
    expect(indexAnalysis?.symbols.map((symbol) => symbol.name)).toEqual(['run', 'IMPORTANT_VALUE']);
    expect(utilsAnalysis?.symbols.map((symbol) => symbol.name)).toEqual([
      'User',
      'UserId',
      'Role',
      'helper',
      'makeMessage',
      'Greeter',
      'greet'
    ]);
    expect(indexAnalysis?.edges.map((edge) => edge.toFqName)).toContain('src/utils.ts::helper');
    expect(utilsAnalysis?.edges.map((edge) => edge.toFqName)).toContain('src/utils.ts::helper');
    expect(edgeCasesAnalysis?.symbols.map((symbol) => symbol.name)).toEqual([
      'Speaker',
      'LoudGreeter',
      'speak',
      'outer'
    ]);
    expect(
      edgeCasesAnalysis?.edges.filter((edge) => edge.type === 'extends').map((edge) => edge.toFqName)
    ).toEqual(['src/utils.ts::Greeter']);
    expect(
      edgeCasesAnalysis?.edges.filter((edge) => edge.type === 'implements').map((edge) => edge.toFqName)
    ).toEqual(['src/edge-cases.ts::Speaker']);
    expect(
      edgeCasesAnalysis?.edges.filter((edge) => edge.fromTempId === 'src/edge-cases.ts::outer').map((edge) => edge.toFqName)
    ).toEqual(['src/utils.ts::helper']);
    expect(analysisResult.errors).toEqual([]);
  });
});
