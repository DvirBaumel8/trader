import type { InputHTMLAttributes } from 'react';
import { inputClasses, type InputSize } from './inputClasses';

/** The app's text input. See `inputClasses` for the styling and its reasoning. */
export function Input({
  size = 'md',
  className = '',
  ...rest
}: { size?: InputSize; className?: string } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size'
>) {
  return <input {...rest} className={inputClasses(size, className)} />;
}
