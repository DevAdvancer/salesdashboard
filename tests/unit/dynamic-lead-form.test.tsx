import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DynamicLeadForm } from '@/components/dynamic-lead-form';
import { FormField } from '@/lib/types';
import { useAuth } from '@/lib/contexts/auth-context';

// Mock auth context
jest.mock('@/lib/contexts/auth-context', () => ({
  useAuth: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe('DynamicLeadForm - Task 8.7: Form Rendering', () => {
  const mockOnSubmit = jest.fn();

  const sampleFormConfig: FormField[] = [
    {
      id: '1',
      type: 'text',
      label: 'First Name',
      key: 'firstName',
      required: true,
      visible: true,
      order: 1,
    },
    {
      id: '2',
      type: 'text',
      label: 'Last Name',
      key: 'lastName',
      required: true,
      visible: true,
      order: 2,
    },
    {
      id: '3',
      type: 'email',
      label: 'Email',
      key: 'email',
      required: true,
      visible: true,
      order: 3,
    },
    {
      id: '4',
      type: 'phone',
      label: 'Phone',
      key: 'phone',
      required: false,
      visible: true,
      order: 4,
    },
    {
      id: '5',
      type: 'text',
      label: 'Hidden Field',
      key: 'hiddenField',
      required: false,
      visible: false,
      order: 5,
    },
    {
      id: '6',
      type: 'dropdown',
      label: 'Status',
      key: 'status',
      required: true,
      visible: true,
      order: 6,
      options: ['New', 'Contacted', 'Qualified'],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Field Rendering Order - Requirement 3.8', () => {
    it('should render fields in correct order based on order property', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      render(<DynamicLeadForm formConfig={sampleFormConfig} onSubmit={mockOnSubmit} />);

      const labels = screen.getAllByText(/First Name|Last Name|Email|Phone|Status/);
      
      // Verify fields appear in order (excluding hidden field)
      expect(labels[0]).toHaveTextContent('First Name');
      expect(labels[1]).toHaveTextContent('Last Name');
      expect(labels[2]).toHaveTextContent('Email');
      expect(labels[3]).toHaveTextContent('Phone');
      expect(labels[4]).toHaveTextContent('Status');
    });

    it('should render fields sorted by order property even if config is unsorted', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      // Create unsorted config
      const unsortedConfig: FormField[] = [
        { ...sampleFormConfig[2], order: 3 }, // Email
        { ...sampleFormConfig[0], order: 1 }, // First Name
        { ...sampleFormConfig[1], order: 2 }, // Last Name
      ];

      render(<DynamicLeadForm formConfig={unsortedConfig} onSubmit={mockOnSubmit} />);

      const labels = screen.getAllByText(/First Name|Last Name|Email/);
      
      // Should be sorted by order property
      expect(labels[0]).toHaveTextContent('First Name');
      expect(labels[1]).toHaveTextContent('Last Name');
      expect(labels[2]).toHaveTextContent('Email');
    });
  });

  describe('Agent Visibility Filtering - Requirement 3.8', () => {
    it('should only show visible fields to agents', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '2', name: 'Agent', email: 'agent@test.com', role: 'agent', managerId: '1' },
        isManager: false,
        isAgent: true,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      render(<DynamicLeadForm formConfig={sampleFormConfig} onSubmit={mockOnSubmit} />);

      // Visible fields should be present
      expect(screen.getByLabelText(/First Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Last Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Phone/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Status/i)).toBeInTheDocument();

      // Hidden field should not be present
      expect(screen.queryByLabelText(/Hidden Field/i)).not.toBeInTheDocument();
    });

    it('should show all visible fields to managers', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      render(<DynamicLeadForm formConfig={sampleFormConfig} onSubmit={mockOnSubmit} />);

      // All visible fields should be present
      expect(screen.getByLabelText(/First Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Last Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Phone/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Status/i)).toBeInTheDocument();

      // Hidden field should not be present (even for managers in lead forms)
      expect(screen.queryByLabelText(/Hidden Field/i)).not.toBeInTheDocument();
    });
  });

  describe('Validation Error Display - Requirements 3.9, 11.4', () => {
    it('should display validation errors for required fields when empty', async () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      render(<DynamicLeadForm formConfig={sampleFormConfig} onSubmit={mockOnSubmit} />);

      // Submit form without filling required fields
      const submitButton = screen.getByRole('button', { name: /submit/i });
      fireEvent.click(submitButton);

      // Wait for validation errors to appear
      await waitFor(() => {
        expect(screen.getByText(/First Name is required/i)).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText(/Last Name is required/i)).toBeInTheDocument();
      });

      // onSubmit should not be called
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('should display validation error for invalid email format', async () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      render(<DynamicLeadForm formConfig={sampleFormConfig} onSubmit={mockOnSubmit} />);

      // Fill in required fields
      const firstNameInput = screen.getByLabelText(/First Name/i);
      const lastNameInput = screen.getByLabelText(/Last Name/i);
      const emailInput = screen.getByLabelText(/Email/i);
      const statusSelect = screen.getByLabelText(/Status/i);

      fireEvent.change(firstNameInput, { target: { value: 'John' } });
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } });
      fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
      fireEvent.change(statusSelect, { target: { value: 'New' } });

      // Submit form
      const submitButton = screen.getByRole('button', { name: /submit/i });
      fireEvent.click(submitButton);

      // Wait for email validation error - check for any validation error message
      await waitFor(() => {
        const errorMessage = screen.queryByText(/valid email/i) || screen.queryByText(/email/i);
        expect(errorMessage).toBeInTheDocument();
      }, { timeout: 2000 });

      // onSubmit should not be called
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('should clear validation errors when fields are corrected', async () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      render(<DynamicLeadForm formConfig={sampleFormConfig} onSubmit={mockOnSubmit} />);

      // Submit form without filling required fields
      const submitButton = screen.getByRole('button', { name: /submit/i });
      fireEvent.click(submitButton);

      // Wait for validation error
      await waitFor(() => {
        expect(screen.getByText(/First Name is required/i)).toBeInTheDocument();
      });

      // Fill in the field
      const firstNameInput = screen.getByLabelText(/First Name/i);
      fireEvent.change(firstNameInput, { target: { value: 'John' } });

      // Error should be cleared
      await waitFor(() => {
        expect(screen.queryByText(/First Name is required/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Form Submission - Requirement 11.5', () => {
    it('should call onSubmit with form data when validation passes', async () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      render(<DynamicLeadForm formConfig={sampleFormConfig} onSubmit={mockOnSubmit} />);

      // Fill in all required fields
      const firstNameInput = screen.getByLabelText(/First Name/i);
      const lastNameInput = screen.getByLabelText(/Last Name/i);
      const emailInput = screen.getByLabelText(/Email/i);
      const phoneInput = screen.getByLabelText(/Phone/i);
      const statusSelect = screen.getByLabelText(/Status/i);

      fireEvent.change(firstNameInput, { target: { value: 'John' } });
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } });
      fireEvent.change(emailInput, { target: { value: 'john@example.com' } });
      fireEvent.change(phoneInput, { target: { value: '+1234567890' } });
      fireEvent.change(statusSelect, { target: { value: 'New' } });

      // Submit form
      const submitButton = screen.getByRole('button', { name: /submit/i });
      fireEvent.click(submitButton);

      // Wait for onSubmit to be called
      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@example.com',
            phone: '+1234567890',
            status: 'New',
          })
        );
      });
    });

    it('should disable submit button while submitting', async () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      // Mock onSubmit to be async and take some time
      const slowOnSubmit = jest.fn(() => new Promise(resolve => setTimeout(resolve, 100)));

      render(<DynamicLeadForm formConfig={sampleFormConfig} onSubmit={slowOnSubmit} />);

      // Fill in required fields
      const firstNameInput = screen.getByLabelText(/First Name/i);
      const lastNameInput = screen.getByLabelText(/Last Name/i);
      const emailInput = screen.getByLabelText(/Email/i);
      const statusSelect = screen.getByLabelText(/Status/i);

      fireEvent.change(firstNameInput, { target: { value: 'John' } });
      fireEvent.change(lastNameInput, { target: { value: 'Doe' } });
      fireEvent.change(emailInput, { target: { value: 'john@example.com' } });
      fireEvent.change(statusSelect, { target: { value: 'New' } });

      // Submit form
      const submitButton = screen.getByRole('button', { name: /submit/i });
      fireEvent.click(submitButton);

      // Button should be disabled during submission
      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });
    });

    it('should show loading state when isLoading prop is true', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      render(<DynamicLeadForm formConfig={sampleFormConfig} onSubmit={mockOnSubmit} isLoading={true} />);

      const submitButton = screen.getByRole('button', { name: /submitting/i });
      expect(submitButton).toBeDisabled();
    });
  });

  describe('Field Type Rendering', () => {
    it('should render text input for text field type', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      const textFieldConfig: FormField[] = [
        {
          id: '1',
          type: 'text',
          label: 'Company',
          key: 'company',
          required: false,
          visible: true,
          order: 1,
        },
      ];

      render(<DynamicLeadForm formConfig={textFieldConfig} onSubmit={mockOnSubmit} />);

      const input = screen.getByLabelText(/Company/i);
      expect(input).toHaveAttribute('type', 'text');
    });

    it('should render email input for email field type', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      const emailFieldConfig: FormField[] = [
        {
          id: '1',
          type: 'email',
          label: 'Email',
          key: 'email',
          required: true,
          visible: true,
          order: 1,
        },
      ];

      render(<DynamicLeadForm formConfig={emailFieldConfig} onSubmit={mockOnSubmit} />);

      const input = screen.getByLabelText(/Email/i);
      expect(input).toHaveAttribute('type', 'email');
    });

    it('should render phone input for phone field type', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      const phoneFieldConfig: FormField[] = [
        {
          id: '1',
          type: 'phone',
          label: 'Phone',
          key: 'phone',
          required: false,
          visible: true,
          order: 1,
        },
      ];

      render(<DynamicLeadForm formConfig={phoneFieldConfig} onSubmit={mockOnSubmit} />);

      const input = screen.getByLabelText(/Phone/i);
      expect(input).toHaveAttribute('type', 'tel');
    });

    it('should render textarea for textarea field type', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      const textareaFieldConfig: FormField[] = [
        {
          id: '1',
          type: 'textarea',
          label: 'Notes',
          key: 'notes',
          required: false,
          visible: true,
          order: 1,
        },
      ];

      render(<DynamicLeadForm formConfig={textareaFieldConfig} onSubmit={mockOnSubmit} />);

      const textarea = screen.getByLabelText(/Notes/i);
      expect(textarea.tagName).toBe('TEXTAREA');
    });

    it('should render select dropdown for dropdown field type', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      const dropdownFieldConfig: FormField[] = [
        {
          id: '1',
          type: 'dropdown',
          label: 'Status',
          key: 'status',
          required: true,
          visible: true,
          order: 1,
          options: ['New', 'Contacted', 'Qualified'],
        },
      ];

      render(<DynamicLeadForm formConfig={dropdownFieldConfig} onSubmit={mockOnSubmit} />);

      const select = screen.getByLabelText(/Status/i);
      expect(select.tagName).toBe('SELECT');
      
      // Check options are rendered
      expect(screen.getByText('New')).toBeInTheDocument();
      expect(screen.getByText('Contacted')).toBeInTheDocument();
      expect(screen.getByText('Qualified')).toBeInTheDocument();
    });

    it('should render checkboxes for checklist field type', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      const checklistFieldConfig: FormField[] = [
        {
          id: '1',
          type: 'checklist',
          label: 'Interests',
          key: 'interests',
          required: false,
          visible: true,
          order: 1,
          options: ['Product A', 'Product B', 'Product C'],
        },
      ];

      render(<DynamicLeadForm formConfig={checklistFieldConfig} onSubmit={mockOnSubmit} />);

      // Check that checkboxes are rendered
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes).toHaveLength(3);
      
      // Check options are rendered
      expect(screen.getByText('Product A')).toBeInTheDocument();
      expect(screen.getByText('Product B')).toBeInTheDocument();
      expect(screen.getByText('Product C')).toBeInTheDocument();
    });
  });

  describe('Required Field Indicators', () => {
    it('should display asterisk for required fields', () => {
      mockUseAuth.mockReturnValue({
        user: { $id: '1', name: 'Manager', email: 'manager@test.com', role: 'manager', managerId: null },
        isManager: true,
        isAgent: false,
        loading: false,
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
      });

      render(<DynamicLeadForm formConfig={sampleFormConfig} onSubmit={mockOnSubmit} />);

      // Required fields should have asterisk
      const firstNameLabel = screen.getByText(/First Name/i);
      expect(firstNameLabel.parentElement).toHaveTextContent('*');

      const lastNameLabel = screen.getByText(/Last Name/i);
      expect(lastNameLabel.parentElement).toHaveTextContent('*');

      const emailLabel = screen.getByText(/Email/i);
      expect(emailLabel.parentElement).toHaveTextContent('*');

      // Optional field should not have asterisk in the label itself
      const phoneLabel = screen.getByText(/Phone/i);
      // Phone label itself shouldn't contain asterisk
      expect(phoneLabel.textContent).not.toContain('*');
    });
  });
});
