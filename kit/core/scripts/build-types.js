#!/usr/bin/env node
// Generates types/*.d.mts for @launchclip/core from the plain ESM sources
// (npm run build, run by prepack). An argument builds another copy of the
// package instead (test/core_package.test.js packs a copy, so the suite never
// writes into kit/core). tsc's declarations for JavaScript keep a
// destructured parameter's pattern but type it only from the keys that have
// defaults ({canvas, sampleStep = 1/30} → {canvas, sampleStep}?: {sampleStep?:
// number}), which is not valid TypeScript. Each pattern becomes a plain
// `options` parameter whose object type also accepts any other key. Object
// literals come out as namespaces whose members can alias names the file never
// declares (`import leadOut = leadOut`, `export { at as highlightAt }`); those
// members become `let name: any`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const PACKAGE = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

function openPatterns(context) {
  const { factory } = context;
  const widen = (type) => {
    if (!type || !ts.isTypeLiteralNode(type)) return factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
    const index = factory.createIndexSignature(undefined, [factory.createParameterDeclaration(undefined, undefined, 'key', undefined, factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword))], factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword));
    return factory.updateTypeLiteralNode(type, factory.createNodeArray([...type.members, index]));
  };
  const visit = (node) => {
    const seen = { options: 0, values: 0 };
    const child = (inner) => {
      if (!ts.isParameter(inner) || ts.isIdentifier(inner.name)) return visit(inner);
      const array = ts.isArrayBindingPattern(inner.name);
      const base = array ? 'values' : 'options';
      const name = ++seen[base] > 1 ? `${base}${seen[base]}` : base;
      const type = ts.visitNode(inner.type, visit);
      return factory.updateParameterDeclaration(inner, inner.modifiers, inner.dotDotDotToken, name, inner.questionToken, array ? type : widen(type), undefined);
    };
    return ts.visitEachChild(node, child, context);
  };
  return (file) => ts.visitNode(ts.visitNode(file, visit), (root) => ts.visitEachChild(root, function block(node) {
    if (!ts.isModuleBlock(node)) return ts.visitEachChild(node, block, context);
    return factory.updateModuleBlock(node, closeNamespace(factory, node.statements.map((statement) => ts.visitEachChild(statement, block, context))));
  }, context));
}

function closeNamespace(factory, statements) {
  const anyLet = (name, exported) => factory.createVariableStatement(exported ? [factory.createModifier(ts.SyntaxKind.ExportKeyword)] : undefined,
    factory.createVariableDeclarationList([factory.createVariableDeclaration(name, undefined, factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword))], ts.NodeFlags.Let));
  const declared = new Set();
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) if (ts.isIdentifier(item.name)) declared.add(item.name.text);
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isModuleDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) declared.add(statement.name.text);
  }
  return statements.flatMap((statement) => {
    if (ts.isImportEqualsDeclaration(statement)) {
      declared.add(statement.name.text);
      return [anyLet(statement.name.text, false)];
    }
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const local = (spec) => declared.has((spec.propertyName ?? spec.name).text);
      const kept = statement.exportClause.elements.filter(local);
      const loose = statement.exportClause.elements.filter((spec) => !local(spec)).map((spec) => anyLet(spec.name.text, true));
      if (!loose.length) return [statement];
      const exported = kept.length ? [factory.updateExportDeclaration(statement, statement.modifiers, statement.isTypeOnly, factory.updateNamedExports(statement.exportClause, kept), undefined, statement.attributes)] : [];
      return [...exported, ...loose];
    }
    return [statement];
  });
}

const configFile = ts.findConfigFile(PACKAGE, ts.sys.fileExists, 'tsconfig.json');
const { config } = ts.readConfigFile(configFile, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, PACKAGE);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const result = program.emit(undefined, undefined, undefined, true, { afterDeclarations: [openPatterns] });
const problems = ts.getPreEmitDiagnostics(program).concat(result.diagnostics);
if (problems.length) {
  console.error(ts.formatDiagnostics(problems, { getCanonicalFileName: (name) => name, getCurrentDirectory: () => PACKAGE, getNewLine: () => '\n' }));
  process.exit(1);
}
console.error(`types: ${parsed.fileNames.length} declarations in ${path.relative(process.cwd(), path.join(PACKAGE, 'types')) || 'types'}/`);
