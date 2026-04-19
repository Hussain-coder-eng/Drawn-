import DOMPurify from "dompurify";

export function sanitizeInput(input: string): string {
  return DOMPurify.sanitize(input.trim());
}

export function validateDistance(distance: number): number {
  const min = 1;
  const max = 100;
  if (isNaN(distance)) return 5;
  return Math.min(Math.max(distance, min), max);
}

export function validateText(text: string): string {
  const sanitized = sanitizeInput(text);
  return sanitized.slice(0, 20); // Limit to 20 chars
}
