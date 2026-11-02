import React from 'react';
import { render, screen } from '@testing-library/react';
import { ClientCardView } from '@/components/client-progress/client-card-view';

test('the reference layout preserves every numbered feedback and renders hostile content as plain text', () => {
  const hostile = '<img src=x onerror="window.stolen=true"><script>alert(1)</script>';
  const card = { candidateName: hostile, salespersonName: 'Michael Scott', marketingTl: 'Jim Halpert', recruiterName: 'Dwight Schrute', progressStatus: 'Placed',
    enteredAt: '', marketingStartedOn: '2026-09-15', notes: hostile, finalFeedback: 'Overall service review', finalSavedAt: '' };
  const feedback = Array.from({ length: 12 }, (_, i) => ({ text: `${i} ${hostile}`, authorName: 'Reviewer', createdAt: '2026-09-15T12:00:00Z' }));
  const { container } = render(<ClientCardView card={card} feedback={feedback} />);
  expect(screen.getByText('FEEDBACK 1 (INITIAL SERVICE ONBOARDING)')).toBeInTheDocument();
  expect(screen.getByText('FEEDBACK 12')).toBeInTheDocument();
  expect(screen.getByText('FINAL FEEDBACK (OVERALL SERVICE REVIEW)')).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull(); expect(container.querySelector('script')).toBeNull();
  expect(container.textContent).toContain(hostile);
});
