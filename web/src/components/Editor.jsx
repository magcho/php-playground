import CodeMirror from '@uiw/react-codemirror';
import { php } from '@codemirror/lang-php';
import { oneDark } from '@codemirror/theme-one-dark';

export default function Editor({ value, onChange }) {
  return (
    <div className="editor-wrap">
      <CodeMirror
        value={value}
        height="100%"
        theme={oneDark}
        extensions={[php()]}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          autocompletion: true,
        }}
        onChange={(next) => onChange(next)}
      />
    </div>
  );
}
