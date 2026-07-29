"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExternalImports = getExternalImports;
exports.replaceExternalImportsInTypeReference = replaceExternalImportsInTypeReference;
const ts = require("typescript");
function getExternalImports(sourceFile) {
    const externalImports = {};
    const importDeclarations = sourceFile.statements.filter(ts.isImportDeclaration);
    for (const declaration of importDeclarations) {
        const { moduleSpecifier, importClause } = declaration;
        if (!ts.isStringLiteral(moduleSpecifier) ||
            moduleSpecifier.text[0] === '.') {
            continue;
        }
        if ((importClause === null || importClause === void 0 ? void 0 : importClause.namedBindings) &&
            ts.isNamedImports(importClause.namedBindings)) {
            const namedImports = importClause === null || importClause === void 0 ? void 0 : importClause.namedBindings;
            for (const namedImport of namedImports.elements) {
                externalImports[namedImport.name.text] = moduleSpecifier.text;
            }
        }
    }
    return externalImports;
}
function replaceExternalImportsInTypeReference(typeReference, externalImports) {
    const regexp = /import\((.+)\).([^\]]+)(\])?/;
    const match = regexp.exec(typeReference);
    if ((match === null || match === void 0 ? void 0 : match.length) >= 3) {
        const [, importPath, importName] = match;
        if (externalImports[importName]) {
            return typeReference.replace(importPath, `"${externalImports[importName]}"`);
        }
    }
    return typeReference;
}
