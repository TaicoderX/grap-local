import path from 'node:path';

import {
  ModuleKind,
  ModuleResolutionKind,
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
  ts,
  type ArrowFunction,
  type CallExpression,
  type ClassDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type Node as MorphNode,
  type SourceFile,
  type Symbol as MorphSymbol,
  type VariableDeclaration
} from 'ts-morph';

import type { FileAnalysis, RepositoryAnalysisResult } from '../../shared/types/analysis.js';
import type { JsonObject } from '../../shared/types/domain.js';
import { toErrorMessage } from '../../shared/utils/error.js';
import { isSupportedSourceFile, normalizePath, toRepoRelativePath } from '../../shared/utils/path.js';

type CallableOwner = FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression;

const callableBoundaryKinds = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.ArrowFunction,
  SyntaxKind.FunctionExpression
]);

const getNamedClass = (node: MorphNode): ClassDeclaration | undefined => {
  const classAncestor = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);

  if (!classAncestor?.getName()) {
    return undefined;
  }

  return classAncestor;
};

const buildFqName = (relativePath: string, symbolName: string, parentName?: string): string => {
  return parentName ? `${relativePath}::${parentName}#${symbolName}` : `${relativePath}::${symbolName}`;
};

const extractParentSymbolName = (parentTempId?: string): string | undefined => {
  if (!parentTempId) {
    return undefined;
  }

  const parentSection = parentTempId.split('::').pop();

  if (!parentSection) {
    return undefined;
  }

  return parentSection.split('#')[0];
};

const buildFqNameFromDeclaration = (node: MorphNode, repoRoot: string): string | null => {
  const sourcePath = node.getSourceFile().getFilePath();

  if (!isSupportedSourceFile(sourcePath)) {
    return null;
  }

  const relativePath = toRepoRelativePath(repoRoot, sourcePath);

  if (Node.isMethodDeclaration(node)) {
    const parentClass = getNamedClass(node);

    if (!parentClass?.getName() || !node.getName()) {
      return null;
    }

    return buildFqName(relativePath, node.getName(), parentClass.getName());
  }

  if (Node.isFunctionDeclaration(node)) {
    const name = node.getName();
    return name ? buildFqName(relativePath, name) : null;
  }

  if (Node.isClassDeclaration(node)) {
    const name = node.getName();
    return name ? buildFqName(relativePath, name) : null;
  }

  if (Node.isInterfaceDeclaration(node) || Node.isTypeAliasDeclaration(node) || Node.isEnumDeclaration(node)) {
    return buildFqName(relativePath, node.getName());
  }

  if (Node.isVariableDeclaration(node)) {
    const variableStatement = node.getFirstAncestorByKind(SyntaxKind.VariableStatement);

    if (!variableStatement?.getParentIfKind(SyntaxKind.SourceFile)) {
      return null;
    }

    return buildFqName(relativePath, node.getName());
  }

  return null;
};

const resolveTargetFqName = (symbol: MorphSymbol | undefined, repoRoot: string): string | null => {
  const actualSymbol = symbol?.getAliasedSymbol() ?? symbol;
  const declarations = actualSymbol?.getDeclarations() ?? [];

  for (const declaration of declarations) {
    const fqName = buildFqNameFromDeclaration(declaration, repoRoot);

    if (fqName) {
      return fqName;
    }
  }

  return null;
};

const isMeaningfulVariableDeclaration = (declaration: VariableDeclaration): boolean => {
  const variableStatement = declaration.getFirstAncestorByKind(SyntaxKind.VariableStatement);
  const initializer = declaration.getInitializer();
  const declarationName = declaration.getName();
  const upperCaseLike = declarationName.toUpperCase() === declarationName && declarationName.length > 1;

  if (!variableStatement) {
    return false;
  }

  if (variableStatement.isExported()) {
    return true;
  }

  if (!initializer) {
    return upperCaseLike;
  }

  return (
    Node.isArrowFunction(initializer) ||
    Node.isFunctionExpression(initializer) ||
    Node.isObjectLiteralExpression(initializer) ||
    Node.isClassExpression(initializer) ||
    Node.isNewExpression(initializer) ||
    upperCaseLike
  );
};

const describeSignature = (node: MorphNode, name: string): string => {
  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
    const params = node.getParameters().map((parameter) => parameter.getText()).join(', ');
    const returnType = node.getReturnTypeNode()?.getText();
    return `${name}(${params})${returnType ? `: ${returnType}` : ''}`;
  }

  if (Node.isClassDeclaration(node)) {
    return `class ${name}`;
  }

  if (Node.isInterfaceDeclaration(node)) {
    return `interface ${name}`;
  }

  if (Node.isTypeAliasDeclaration(node)) {
    return `type ${name} = ${node.getTypeNode()?.getText() ?? 'unknown'}`;
  }

  if (Node.isEnumDeclaration(node)) {
    return `enum ${name}`;
  }

  if (Node.isVariableDeclaration(node)) {
    return `const ${name}`;
  }

  return name;
};

const buildMetadata = (node: MorphNode): JsonObject => {
  if (Node.isClassDeclaration(node)) {
    return {
      abstract: node.isAbstract(),
      methods: node.getMethods().map((method) => method.getName())
    };
  }

  if (Node.isFunctionDeclaration(node)) {
    return {
      async: node.isAsync(),
      parameters: node.getParameters().map((parameter) => parameter.getName())
    };
  }

  if (Node.isMethodDeclaration(node)) {
    return {
      async: node.isAsync(),
      static: node.isStatic(),
      scope: node.getScope() ?? 'public',
      parameters: node.getParameters().map((parameter) => parameter.getName())
    };
  }

  if (Node.isInterfaceDeclaration(node)) {
    return {
      members: node.getMembers().map((member) => member.getKindName())
    };
  }

  if (Node.isTypeAliasDeclaration(node)) {
    return {
      type: node.getTypeNode()?.getText() ?? 'unknown'
    };
  }

  if (Node.isEnumDeclaration(node)) {
    return {
      members: node.getMembers().map((member) => member.getName())
    };
  }

  if (Node.isVariableDeclaration(node)) {
    return {
      initializerKind: node.getInitializer()?.getKindName() ?? 'unknown'
    };
  }

  return {};
};

const isExportedDeclaration = (node: MorphNode): boolean => {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isClassDeclaration(node) ||
    Node.isInterfaceDeclaration(node) ||
    Node.isTypeAliasDeclaration(node) ||
    Node.isEnumDeclaration(node) ||
    Node.isVariableDeclaration(node)
  ) {
    return node.isExported();
  }

  return false;
};

const belongsToOwner = (callExpression: CallExpression, ownerNode: CallableOwner): boolean => {
  const nestedCallable = callExpression.getFirstAncestor((ancestor) => callableBoundaryKinds.has(ancestor.getKind()));
  return nestedCallable === ownerNode;
};

const collectCallEdges = (
  ownerTempId: string,
  ownerNode: CallableOwner,
  repoRoot: string,
  edges: FileAnalysis['edges']
): void => {
  const seenEdges = new Set<string>();

  for (const callExpression of ownerNode.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!belongsToOwner(callExpression, ownerNode)) {
      continue;
    }

    const expression = callExpression.getExpression();
    const fqName =
      resolveTargetFqName(expression.getSymbol(), repoRoot) ??
      resolveTargetFqName(expression.getType().getSymbol(), repoRoot);

    if (!fqName) {
      continue;
    }

    const dedupeKey = `${ownerTempId}:${fqName}:calls`;

    if (seenEdges.has(dedupeKey)) {
      continue;
    }

    seenEdges.add(dedupeKey);
    edges.push({
      fromTempId: ownerTempId,
      toFqName: fqName,
      type: 'calls',
      metadata: {
        line: callExpression.getStartLineNumber(),
        expression: expression.getText()
      }
    });
  }
};

const collectHeritageEdges = (
  classNode: ClassDeclaration,
  ownerTempId: string,
  repoRoot: string,
  edges: FileAnalysis['edges']
): void => {
  const seenEdges = new Set<string>();

  for (const heritageClause of classNode.getHeritageClauses()) {
    for (const typeNode of heritageClause.getTypeNodes()) {
      const fqName =
        resolveTargetFqName(typeNode.getExpression().getSymbol(), repoRoot) ??
        resolveTargetFqName(typeNode.getType().getSymbol(), repoRoot);

      if (!fqName) {
        continue;
      }

      const edgeType = heritageClause.getToken() === SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
      const dedupeKey = `${ownerTempId}:${fqName}:${edgeType}`;

      if (seenEdges.has(dedupeKey)) {
        continue;
      }

      seenEdges.add(dedupeKey);
      edges.push({
        fromTempId: ownerTempId,
        toFqName: fqName,
        type: edgeType,
        metadata: {
          text: typeNode.getText()
        }
      });
    }
  }
};

const analyzeSourceFile = (sourceFile: SourceFile, repoRoot: string): FileAnalysis => {
  const relativePath = toRepoRelativePath(repoRoot, sourceFile.getFilePath());
  const symbols: FileAnalysis['symbols'] = [];
  const edges: FileAnalysis['edges'] = [];
  const seenSymbols = new Set<string>();

  const pushSymbol = (
    node: MorphNode,
    kind: FileAnalysis['symbols'][number]['kind'],
    name: string,
    parentTempId?: string
  ): string | null => {
    const fqName = buildFqName(relativePath, name, extractParentSymbolName(parentTempId));
    const tempId = fqName;

    if (seenSymbols.has(tempId)) {
      return null;
    }

    seenSymbols.add(tempId);

    const symbol: FileAnalysis['symbols'][number] = {
      tempId,
      name,
      kind,
      fqName,
      exported: isExportedDeclaration(node),
      startLine: node.getStartLineNumber(),
      endLine: node.getEndLineNumber(),
      signature: describeSignature(node, name),
      metadata: buildMetadata(node)
    };

    if (parentTempId) {
      symbol.parentTempId = parentTempId;
    }

    symbols.push(symbol);
    return tempId;
  };

  for (const statement of sourceFile.getStatements()) {
    if (Node.isFunctionDeclaration(statement)) {
      const functionName = statement.getName();

      if (!functionName) {
        continue;
      }

      const tempId = pushSymbol(statement, 'function', functionName);

      if (tempId) {
        collectCallEdges(tempId, statement, repoRoot, edges);
      }

      continue;
    }

    if (Node.isClassDeclaration(statement)) {
      const className = statement.getName();

      if (!className) {
        continue;
      }

      const classTempId = pushSymbol(statement, 'class', className);

      if (!classTempId) {
        continue;
      }

      collectHeritageEdges(statement, classTempId, repoRoot, edges);

      for (const method of statement.getMethods()) {
        const methodTempId = pushSymbol(method, 'method', method.getName(), classTempId);

        if (methodTempId) {
          collectCallEdges(methodTempId, method, repoRoot, edges);
        }
      }

      continue;
    }

    if (Node.isInterfaceDeclaration(statement)) {
      pushSymbol(statement, 'interface', statement.getName());
      continue;
    }

    if (Node.isTypeAliasDeclaration(statement)) {
      pushSymbol(statement, 'typeAlias', statement.getName());
      continue;
    }

    if (Node.isEnumDeclaration(statement)) {
      pushSymbol(statement, 'enum', statement.getName());
      continue;
    }

    if (Node.isVariableStatement(statement)) {
      for (const declaration of statement.getDeclarations()) {
        if (!isMeaningfulVariableDeclaration(declaration)) {
          continue;
        }

        const variableTempId = pushSymbol(declaration, 'variable', declaration.getName());
        const initializer = declaration.getInitializer();

        if (
          variableTempId &&
          initializer &&
          (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
        ) {
          collectCallEdges(variableTempId, initializer, repoRoot, edges);
        }
      }
    }
  }

  return {
    absolutePath: sourceFile.getFilePath(),
    relativePath,
    imports: [...new Set(sourceFile.getImportDeclarations().map((declaration) => declaration.getModuleSpecifierValue()))],
    symbols,
    edges
  };
};

export class CodeAnalyzer {
  public analyzeRepository(input: {
    repoRoot: string;
    allFiles: string[];
    targetFiles: string[];
  }): RepositoryAnalysisResult {
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        jsx: ts.JsxEmit.Preserve,
        module: ModuleKind.NodeNext,
        moduleResolution: ModuleResolutionKind.NodeNext,
        target: ScriptTarget.ES2022
      }
    });

    project.addSourceFilesAtPaths(input.allFiles);
    project.resolveSourceFileDependencies();
    const targetFiles = new Set(input.targetFiles.map((filePath) => normalizePath(path.resolve(filePath))));
    const analyses: RepositoryAnalysisResult['analyses'] = [];
    const errors: RepositoryAnalysisResult['errors'] = [];
    const seenTargets = new Set<string>();

    for (const sourceFile of project.getSourceFiles()) {
      const normalizedSourcePath = normalizePath(path.resolve(sourceFile.getFilePath()));

      if (!targetFiles.has(normalizedSourcePath)) {
        continue;
      }

      seenTargets.add(normalizedSourcePath);

      try {
        analyses.push(analyzeSourceFile(sourceFile, input.repoRoot));
      } catch (error) {
        errors.push({
          filePath: sourceFile.getFilePath(),
          message: toErrorMessage(error)
        });
      }
    }

    for (const targetFile of targetFiles) {
      if (seenTargets.has(targetFile)) {
        continue;
      }

      errors.push({
        filePath: targetFile,
        message: 'ts-morph could not load this source file'
      });
    }

    return {
      analyses,
      errors
    };
  }
}

export const codeAnalyzer = new CodeAnalyzer();
