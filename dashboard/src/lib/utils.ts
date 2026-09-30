import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { SentimentLabel } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function scoreToLabel(score: number): SentimentLabel {
  if (score >= 0.15) return 'Positive';
  if (score <= -0.15) return 'Negative';
  return 'Neutral';
}

export function scoreColor(score: number): string {
  if (score >= 0.15) return 'text-positive';
  if (score <= -0.15) return 'text-negative';
  return 'text-neutral';
}

export function scoreHex(score: number): string {
  if (score >= 0.15) return '#00C853';
  if (score <= -0.15) return '#D32F2F';
  return '#9E9E9E';
}
