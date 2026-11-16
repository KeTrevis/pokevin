import { TypeScriptWorker, initialize } from 'monaco-editor/language/typescript/ts.worker.js';

class ScriptWorker extends TypeScriptWorker {
  getSemanticTokens(fileName, length) {
    return this.getLanguageService().getEncodedSemanticClassifications(fileName, { start: 0, length }, '2020').spans;
  }
}

self.onmessage = () => {
  initialize((context, data) => new ScriptWorker(context, data));
};
