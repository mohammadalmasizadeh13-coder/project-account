import React, { useLayoutEffect, useRef, useState } from 'react';
import { formatNumberInput, numberInputEdit } from './numberInput.js';

// Same target.name/target.value contract as the other controlled form inputs;
// callers receive ungrouped ASCII numbers while users see thousands separators.
export default function NumberInput({ value = '', name, onChange, inputMode = 'decimal', dir = 'ltr', maxLength, ...props }) {
  const ref = useRef(null);
  const [selection, setSelection] = useState(null);
  const formatted = formatNumberInput(value);

  useLayoutEffect(() => {
    if (selection && document.activeElement === ref.current) {
      ref.current.setSelectionRange(selection.start, selection.end);
    }
  }, [formatted, selection]);

  function change(event) {
    const edited = numberInputEdit({
      text: event.target.value,
      start: event.target.selectionStart,
      end: event.target.selectionEnd,
      previousValue: value,
      inputType: event.nativeEvent?.inputType,
    });
    if (!edited || (maxLength && edited.value.length > maxLength)) return;
    setSelection({ start: edited.start, end: edited.end });
    const target = { name, value: edited.value, id: props.id, type: 'text' };
    onChange?.({ target, currentTarget: target });
  }

  return <input {...props} ref={ref} name={name} type="text" inputMode={inputMode} dir={dir}
    value={formatted} onChange={change}/>;
}
