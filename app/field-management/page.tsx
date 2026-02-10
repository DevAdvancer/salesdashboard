'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { FormField, FieldType } from '@/lib/types';
import { getFormConfig, updateFormConfig } from '@/lib/services/form-config-service';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { 
  Eye, 
  EyeOff, 
  GripVertical, 
  Trash2, 
  Plus, 
  Save,
  Asterisk,
  Edit2
} from 'lucide-react';

export default function FieldManagementPage() {
  const { user, isManager } = useAuth();
  const { toast } = useToast();
  const [fields, setFields] = useState<FormField[]>([]);
  const [version, setVersion] = useState(0);
  const [selectedField, setSelectedField] = useState<FormField | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddField, setShowAddField] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);

  useEffect(() => {
    if (!isManager) {
      window.location.href = '/dashboard';
      return;
    }
    loadFormConfig();
  }, [isManager]);

  const loadFormConfig = async () => {
    try {
      setLoading(true);
      const config = await getFormConfig();
      setFields(config.fields);
      setVersion(config.version);
    } catch (error) {
      console.error('Error loading form config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newFields = [...fields];
    const draggedField = newFields[draggedIndex];
    newFields.splice(draggedIndex, 1);
    newFields.splice(index, 0, draggedField);

    // Update order property
    const reorderedFields = newFields.map((field, idx) => ({
      ...field,
      order: idx + 1,
    }));

    setFields(reorderedFields);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleToggleVisibility = (fieldId: string) => {
    setFields(fields.map(field =>
      field.id === fieldId ? { ...field, visible: !field.visible } : field
    ));
  };

  const handleToggleRequired = (fieldId: string) => {
    setFields(fields.map(field =>
      field.id === fieldId ? { ...field, required: !field.required } : field
    ));
  };

  const handleDeleteField = (fieldId: string) => {
    const newFields = fields.filter(f => f.id !== fieldId);
    const reorderedFields = newFields.map((field, idx) => ({
      ...field,
      order: idx + 1,
    }));
    setFields(reorderedFields);
    if (selectedField?.id === fieldId) {
      setSelectedField(null);
    }
  };

  const handleAddField = (type: FieldType) => {
    const newId = String(Math.max(...fields.map(f => parseInt(f.id)), 0) + 1);
    const newField: FormField = {
      id: newId,
      type,
      label: `New ${type} field`,
      key: `field_${newId}`,
      required: false,
      visible: true,
      order: fields.length + 1,
      ...(type === 'dropdown' || type === 'checklist' ? { options: ['Option 1', 'Option 2'] } : {}),
    };
    setFields([...fields, newField]);
    setSelectedField(newField);
    setShowAddField(false);
  };

  const handleUpdateField = (updates: Partial<FormField>) => {
    if (!selectedField) return;
    
    const updatedFields = fields.map(field =>
      field.id === selectedField.id ? { ...field, ...updates } : field
    );
    setFields(updatedFields);
    setSelectedField({ ...selectedField, ...updates });
  };

  const handleSave = async () => {
    if (!user) return;
    
    try {
      setSaving(true);
      const result = await updateFormConfig(fields, user.$id);
      setVersion(result.version);
      setShowPublishConfirm(false);
      
      toast({
        title: "Success",
        description: `Form configuration published successfully! Version ${result.version}`,
      });
      
      await loadFormConfig();
    } catch (error) {
      console.error('Error saving form config:', error);
      
      toast({
        title: "Error",
        description: "Failed to save form configuration. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Form Builder</h1>
          <p className="text-muted-foreground">Configure lead form fields</p>
        </div>
        <Button onClick={() => setShowPublishConfirm(true)} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          Publish Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Field List */}
        <Card className="p-4 lg:col-span-1">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Fields</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddField(!showAddField)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {showAddField && (
            <div className="mb-4 p-3 border rounded-md space-y-2">
              <p className="text-sm font-medium">Add Field Type:</p>
              <div className="grid grid-cols-2 gap-2">
                {(['text', 'email', 'phone', 'dropdown', 'textarea', 'checklist'] as FieldType[]).map(type => (
                  <Button
                    key={type}
                    size="sm"
                    variant="outline"
                    onClick={() => handleAddField(type)}
                  >
                    {type}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {fields.map((field, index) => (
              <div
                key={field.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onClick={() => setSelectedField(field)}
                className={`p-3 border rounded-md cursor-move hover:bg-accent transition-colors ${
                  selectedField?.id === field.id ? 'bg-accent border-primary' : ''
                } ${draggedIndex === index ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{field.label}</span>
                      {field.required && (
                        <Asterisk className="h-3 w-3 text-red-500" />
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{field.type}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleVisibility(field.id);
                      }}
                      className="p-1 hover:bg-background rounded"
                    >
                      {field.visible ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteField(field.id);
                      }}
                      className="p-1 hover:bg-destructive/10 rounded"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Field Editor */}
        <Card className="p-4 lg:col-span-1">
          <h2 className="text-xl font-semibold mb-4">Field Editor</h2>
          {selectedField ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  value={selectedField.label}
                  onChange={(e) => handleUpdateField({ label: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="key">Key</Label>
                <Input
                  id="key"
                  value={selectedField.key}
                  onChange={(e) => handleUpdateField({ key: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="type">Type</Label>
                <select
                  id="type"
                  value={selectedField.type}
                  onChange={(e) => handleUpdateField({ type: e.target.value as FieldType })}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                >
                  <option value="text">Text</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="dropdown">Dropdown</option>
                  <option value="textarea">Textarea</option>
                  <option value="checklist">Checklist</option>
                </select>
              </div>

              <div>
                <Label htmlFor="placeholder">Placeholder</Label>
                <Input
                  id="placeholder"
                  value={selectedField.placeholder || ''}
                  onChange={(e) => handleUpdateField({ placeholder: e.target.value })}
                />
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedField.required}
                    onChange={(e) => handleUpdateField({ required: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>Required</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedField.visible}
                    onChange={(e) => handleUpdateField({ visible: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>Visible</span>
                </label>
              </div>

              {(selectedField.type === 'dropdown' || selectedField.type === 'checklist') && (
                <div>
                  <Label>Options</Label>
                  <div className="space-y-2">
                    {(selectedField.options || []).map((option, idx) => (
                      <div key={idx} className="flex gap-2">
                        <Input
                          value={option}
                          onChange={(e) => {
                            const newOptions = [...(selectedField.options || [])];
                            newOptions[idx] = e.target.value;
                            handleUpdateField({ options: newOptions });
                          }}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const newOptions = (selectedField.options || []).filter((_, i) => i !== idx);
                            handleUpdateField({ options: newOptions });
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const newOptions = [...(selectedField.options || []), `Option ${(selectedField.options?.length || 0) + 1}`];
                        handleUpdateField({ options: newOptions });
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Option
                    </Button>
                  </div>
                </div>
              )}

              {selectedField.type === 'text' && (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="pattern">Validation Pattern (regex)</Label>
                    <Input
                      id="pattern"
                      value={selectedField.validation?.pattern || ''}
                      onChange={(e) => handleUpdateField({
                        validation: { ...selectedField.validation, pattern: e.target.value }
                      })}
                      placeholder="e.g., ^\d{4}$"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="minLength">Min Length</Label>
                      <Input
                        id="minLength"
                        type="number"
                        value={selectedField.validation?.minLength || ''}
                        onChange={(e) => handleUpdateField({
                          validation: { ...selectedField.validation, minLength: parseInt(e.target.value) || undefined }
                        })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="maxLength">Max Length</Label>
                      <Input
                        id="maxLength"
                        type="number"
                        value={selectedField.validation?.maxLength || ''}
                        onChange={(e) => handleUpdateField({
                          validation: { ...selectedField.validation, maxLength: parseInt(e.target.value) || undefined }
                        })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              Select a field to edit its properties
            </div>
          )}
        </Card>

        {/* Form Preview */}
        <Card className="p-4 lg:col-span-1">
          <h2 className="text-xl font-semibold mb-4">Agent View Preview</h2>
          <div className="space-y-4">
            {fields
              .filter(field => field.visible)
              .sort((a, b) => a.order - b.order)
              .map(field => (
                <div key={field.id}>
                  <Label>
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </Label>
                  {field.type === 'textarea' ? (
                    <textarea
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2 border rounded-md bg-background min-h-[80px]"
                      disabled
                    />
                  ) : field.type === 'dropdown' ? (
                    <select
                      className="w-full px-3 py-2 border rounded-md bg-background"
                      disabled
                    >
                      <option value="">Select...</option>
                      {field.options?.map((option, idx) => (
                        <option key={idx} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'checklist' ? (
                    <div className="space-y-2 mt-2">
                      {field.options?.map((option, idx) => (
                        <label key={idx} className="flex items-center gap-2">
                          <input type="checkbox" disabled className="w-4 h-4" />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <Input
                      type={field.type}
                      placeholder={field.placeholder}
                      disabled
                    />
                  )}
                </div>
              ))}
          </div>
        </Card>
      </div>

      {/* Publish Confirmation Dialog */}
      {showPublishConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4 p-6">
            <h2 className="text-xl font-semibold mb-4">Publish Form Configuration?</h2>
            <p className="text-muted-foreground mb-6">
              This will update the form configuration for all users. The version will be incremented from {version} to {version + 1}.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowPublishConfirm(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Publishing...' : 'Publish'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
