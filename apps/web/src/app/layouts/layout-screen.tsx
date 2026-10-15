import { createElement } from 'react';
import { useProfile } from '@features/profile';
import { type LayoutScreen as Screen, screenFor } from './registry';

/** Renders the active layout's version of a per-layout screen. */
export function LayoutScreen({ screen }: { screen: Screen }) {
  return createElement(screenFor(useProfile().layout, screen));
}
