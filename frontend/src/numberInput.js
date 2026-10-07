const grouping = /[,٬\s\u200e\u200f\u061c]/g;

// Keep input as text: converting to Number would round long prices and remove
// decimal places while the user is still entering them.
export function normalizeNumberInput(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/٫/g, '.').replace(/−/g, '-').replace(grouping, '');
}

const editableNumber = /^-?\d*(?:\.\d*)?$/;

export function formatNumberInput(value) {
  const normalized = normalizeNumberInput(value);
  if (!editableNumber.test(normalized)) return String(value ?? '');
  const [integer, fraction] = normalized.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function displayPosition(formatted, rawPosition) {
  if (rawPosition === 0) return 0;
  let count = 0;
  for (let position = 0; position < formatted.length; position += 1) {
    if (formatted[position] !== ',') count += 1;
    if (count === rawPosition) return position + 1;
  }
  return formatted.length;
}

// Map the browser's edited text and selection back to the regrouped display.
// Deleting a grouping comma removes the adjacent digit, including on mobile
// keyboards that emit an input event without a keydown event.
export function numberInputEdit({ text, start = text.length, end = start, previousValue = '', inputType = '' }) {
  let value = normalizeNumberInput(text);
  if (!editableNumber.test(value)) return null;
  let rawStart = normalizeNumberInput(text.slice(0, start)).length;
  let rawEnd = normalizeNumberInput(text.slice(0, end)).length;
  if (value === normalizeNumberInput(previousValue) && text !== formatNumberInput(previousValue) && start === end) {
    if (inputType === 'deleteContentBackward' && rawStart > 0) {
      value = value.slice(0, rawStart - 1) + value.slice(rawStart);
      rawStart -= 1;
      rawEnd = rawStart;
    } else if (inputType === 'deleteContentForward' && rawStart < value.length) {
      value = value.slice(0, rawStart) + value.slice(rawStart + 1);
    }
  }
  const formatted = formatNumberInput(value);
  return { value, formatted, start: displayPosition(formatted, rawStart), end: displayPosition(formatted, rawEnd) };
}
