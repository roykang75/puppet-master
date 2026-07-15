import Parser = require('tree-sitter');
import * as path from 'path';

export interface LanguageSpec {
  id: string;
  extensions: string[];
  grammar: unknown;
  query: string;
}

const C_QUERY = `
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def.function
(type_definition declarator: (type_identifier) @name) @def.type
(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @def.struct
(enum_specifier name: (type_identifier) @name body: (enumerator_list)) @def.enum
(preproc_def name: (identifier) @name) @def.macro
(preproc_function_def name: (identifier) @name) @def.macro
(translation_unit (declaration declarator: (identifier) @name) @def.variable)
(translation_unit (declaration declarator: (init_declarator declarator: (identifier) @name)) @def.variable)
(call_expression function: (identifier) @ref.call)
`;

const TS_QUERY = `
(function_declaration name: (identifier) @name) @def.function
(class_declaration name: (type_identifier) @name) @def.class
(method_definition name: (property_identifier) @name) @def.method
(interface_declaration name: (type_identifier) @name) @def.interface
(type_alias_declaration name: (type_identifier) @name) @def.type
(enum_declaration name: (identifier) @name) @def.enum
(program (lexical_declaration (variable_declarator name: (identifier) @name) @def.variable))
(program (export_statement (lexical_declaration (variable_declarator name: (identifier) @name) @def.variable)))
(public_field_definition name: (property_identifier) @name) @def.field
(call_expression function: (identifier) @ref.call)
(call_expression function: (member_expression property: (property_identifier) @ref.call))
(new_expression constructor: (identifier) @ref.call)
`;

const CPP_QUERY = `
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def.function
(function_definition declarator: (function_declarator declarator: (qualified_identifier name: (identifier) @name))) @def.method
(class_specifier name: (type_identifier) @name body: (field_declaration_list)) @def.class
(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @def.struct
(namespace_definition name: (namespace_identifier) @name) @def.namespace
(field_declaration declarator: (function_declarator declarator: (field_identifier) @name)) @def.method
(type_definition declarator: (type_identifier) @name) @def.type
(enum_specifier name: (type_identifier) @name) @def.enum
(preproc_def name: (identifier) @name) @def.macro
(preproc_function_def name: (identifier) @name) @def.macro
(call_expression function: (identifier) @ref.call)
(call_expression function: (field_expression field: (field_identifier) @ref.call))
`;

const PY_QUERY = `
(function_definition name: (identifier) @name) @def.function
(class_definition name: (identifier) @name) @def.class
(module (expression_statement (assignment left: (identifier) @name) @def.variable))
(call function: (identifier) @ref.call)
(call function: (attribute attribute: (identifier) @ref.call))
`;

const JAVA_QUERY = `
(class_declaration name: (identifier) @name) @def.class
(interface_declaration name: (identifier) @name) @def.interface
(enum_declaration name: (identifier) @name) @def.enum
(method_declaration name: (identifier) @name) @def.method
(constructor_declaration name: (identifier) @name) @def.method
(field_declaration declarator: (variable_declarator name: (identifier) @name)) @def.field
(method_invocation name: (identifier) @ref.call)
(object_creation_expression type: (type_identifier) @ref.call)
`;

// require는 문법 패키지에 타입 정의가 없어 불가피
const tsGrammar = require('tree-sitter-typescript');

export const LANGUAGES: LanguageSpec[] = [
  { id: 'c', extensions: ['.c', '.h'], grammar: require('tree-sitter-c'), query: C_QUERY },
  { id: 'typescript', extensions: ['.ts', '.js', '.mjs', '.cjs'], grammar: tsGrammar.typescript, query: TS_QUERY },
  { id: 'tsx', extensions: ['.tsx', '.jsx'], grammar: tsGrammar.tsx, query: TS_QUERY },
  { id: 'cpp', extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh'], grammar: require('tree-sitter-cpp'), query: CPP_QUERY },
  { id: 'python', extensions: ['.py'], grammar: require('tree-sitter-python'), query: PY_QUERY },
  { id: 'java', extensions: ['.java'], grammar: require('tree-sitter-java'), query: JAVA_QUERY },
];

const byExt = new Map<string, LanguageSpec>();
for (const l of LANGUAGES) for (const e of l.extensions) byExt.set(e, l);

export function languageForPath(p: string): LanguageSpec | null {
  return byExt.get(path.extname(p).toLowerCase()) ?? null;
}

const parserCache = new Map<string, Parser>();
const queryCache = new Map<string, Parser.Query>();

export function getParser(spec: LanguageSpec): Parser {
  let p = parserCache.get(spec.id);
  if (!p) {
    p = new Parser();
    p.setLanguage(spec.grammar as Parser.Language);
    parserCache.set(spec.id, p);
  }
  return p;
}

export function getQuery(spec: LanguageSpec): Parser.Query {
  let q = queryCache.get(spec.id);
  if (!q) {
    q = new Parser.Query(spec.grammar as Parser.Language, spec.query);
    queryCache.set(spec.id, q);
  }
  return q;
}
