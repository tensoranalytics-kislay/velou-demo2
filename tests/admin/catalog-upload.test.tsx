/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CatalogUploadPage from '../../src/app/admin/catalog/page';

// Mock fetch
global.fetch = vi.fn();

// Mock Next.js router
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/catalog',
}));

describe('CatalogUploadPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the upload form', () => {
    const { container } = render(<CatalogUploadPage />);

    expect(screen.getByText('Catalog Upload')).toBeInTheDocument();
    expect(screen.getByLabelText('Vendor ID')).toBeInTheDocument();
    expect(screen.getByLabelText('CSV File')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload & Analyze/i })).toBeInTheDocument();
  });

  it('should display required vs optional fields info', () => {
    render(<CatalogUploadPage />);

    expect(screen.getByText(/We only require a stable/i)).toBeInTheDocument();
    expect(screen.getByText(/product_id/i)).toBeInTheDocument();
    expect(screen.getByText(/short_title/i)).toBeInTheDocument();
    expect(screen.getByText(/product_url/i)).toBeInTheDocument();
  });
});

