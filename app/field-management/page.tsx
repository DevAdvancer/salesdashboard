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
  Edit2,
  ArrowLeft
} from 'lucide-react';
import { ProtectedRoute } from '@/components/protected-route';

export default function FieldManagementPage() {
  return (
    <ProtectedRoute componentKey="field-management">
      <FieldManagementContent />
    </ProtectedRoute>
  );
}

function FieldManagementContent() {
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
    loadFormConfig();
  }, []);

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
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8">
        {/* Back Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.history.back()}
          className="mb-8"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>

        {/* Header Card */}
        <Card className="mb-6 md:mb-8">
          <div className="p-4 sm:p-6 md:p-8">
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
              <div>
                <h1 className="text-xl md:text-2xl font-semibold mb-2">Form Field Management</h1>
                <p className="text-muted-foreground text-sm md:text-base">Configure and manage lead form fields</p>
              </div>
              <Button onClick={() => setShowPublishConfirm(true)} disabled={saving} className="w-full sm:w-auto">
                <Save className="mr-2 h-4 w-4" />
                Publish Changes
              </Button>
            </div>
          </div>
        </Card>

        {/* Main Content Card */}
        <Card>
          <div className="p-4 sm:p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
              {/* Field List */}
              <div className="md:col-span-1">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-lg font-semibold">Fields</h2>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAddField(!showAddField)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {showAddField && (
                  <div className="mb-6 p-4 border border-border rounded-lg space-y-3 bg-muted">
                    <p className="text-sm font-medium">Add Field Type:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['text', 'email', 'phone', 'dropdown', 'textarea', 'checklist'] as FieldType[]).map(type => (
                        <Button
                          key={type}
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddField(type)}
                          className="capitalize"
                        >
                          {type}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  {fields.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      No fields yet. Create your first field to get started.
                    </div>
                  ) : (
                    fields.map((field, index) => (
                      <div
                        key={field.id}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragEnd={handleDragEnd}
                        onClick={() => setSelectedField(field)}
                        className={`p-4 border rounded-lg cursor-move hover:border-primary/50 transition-all ${
                          selectedField?.id === field.id ? 'border-primary bg-accent' : 'border-border'
                        } ${draggedIndex === index ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{field.label}</span>
                              {field.required && (
                                <Asterisk className="h-3 w-3 text-red-500" />
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground capitalize">{field.type}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleVisibility(field.id);
                              }}
                              className="p-1.5 hover:bg-accent rounded transition-colors"
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
                              className="p-1.5 hover:bg-destructive/10 rounded transition-colors"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Field Editor */}
              <div className="md:col-span-1">
                <h2 className="text-lg font-semibold mb-6">Field Editor</h2>
                {selectedField ? (
                  <div className="space-y-5">
                    <div>
                      <Label htmlFor="label" className="text-sm font-medium mb-2 block">Label</Label>
                      <Input
                        id="label"
                        value={selectedField.label}
                        onChange={(e) => handleUpdateField({ label: e.target.value })}
                      />
                    </div>

                    <div>
                      <Label htmlFor="key" className="text-sm font-medium mb-2 block">Key</Label>
                      <Input
                        id="key"
                        value={selectedField.key}
                        onChange={(e) => handleUpdateField({ key: e.target.value })}
                      />
                    </div>

                    <div>
                      <Label htmlFor="type" className="text-sm font-medium mb-2 block">Type</Label>
                      <select
                        id="type"
                        value={selectedField.type}
                        onChange={(e) => handleUpdateField({ type: e.target.value as FieldType })}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 capitalize"
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
                      <Label htmlFor="placeholder" className="text-sm font-medium mb-2 block">Placeholder</Label>
                      <Input
                        id="placeholder"
                        value={selectedField.placeholder || ''}
                        onChange={(e) => handleUpdateField({ placeholder: e.target.value })}
                      />
                    </div>

                    <div className="flex items-center gap-6 pt-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedField.required}
                          onChange={(e) => handleUpdateField({ required: e.target.checked })}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-sm">Required</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedField.visible}
                          onChange={(e) => handleUpdateField({ visible: e.target.checked })}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-sm">Visible</span>
                      </label>
                    </div>

                    {(selectedField.type === 'dropdown' || selectedField.type === 'checklist') && (
                      <div>
                        <Label className="text-sm font-medium mb-2 block">Options</Label>
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
                            className="w-full"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Option
                          </Button>
                        </div>
                      </div>
                    )}

                    {selectedField.type === 'text' && (
                      <div className="space-y-4 pt-2">
                        <div>
                          <Label htmlFor="pattern" className="text-sm font-medium mb-2 block">Validation Pattern (regex)</Label>
                          <Input
                            id="pattern"
                            value={selectedField.validation?.pattern || ''}
                            onChange={(e) => handleUpdateField({
                              validation: { ...selectedField.validation, pattern: e.target.value }
                            })}
                            placeholder="e.g., ^\d{4}$"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor="minLength" className="text-sm font-medium mb-2 block">Min Length</Label>
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
                            <Label htmlFor="maxLength" className="text-sm font-medium mb-2 block">Max Length</Label>
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
                  <div className="text-center text-muted-foreground py-12">
                    Select a field to edit its properties
                  </div>
                )}
              </div>

              {/* Form Preview */}
              <div className="md:col-span-2 lg:col-span-1">
                <h2 className="text-lg font-semibold mb-6">Agent View Preview</h2>
                <div className="space-y-5">
                  {fields.filter(field => field.visible).length === 0 ? (
                    <div className="text-center text-muted-foreground py-12">
                      No visible fields to preview
                    </div>
                  ) : (
                    fields
                      .filter(field => field.visible)
                      .sort((a, b) => a.order - b.order)
                      .map(field => (
                        <div key={field.id}>
                          <Label className="text-sm font-medium mb-2 block">
                            {field.label}
                            {field.required && <span className="text-red-500 ml-1">*</span>}
                          </Label>
                          {field.type === 'textarea' ? (
                            <textarea
                              placeholder={field.placeholder}
                              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground min-h-[80px]"
                              disabled
                            />
                          ) : field.type === 'dropdown' ? (
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
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
                                  <input type="checkbox" disabled className="w-4 h-4 rounded" />
                                  <span className="text-sm">{option}</span>
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
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Publish Confirmation Dialog */}
      {showPublishConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-md sm:mx-4 p-4 sm:p-6 rounded-b-none sm:rounded-b-lg">
            <h2 className="text-lg sm:text-xl font-semibold mb-4">Publish Form Configuration?</h2>
            <p className="text-muted-foreground mb-6 text-sm sm:text-base">
              This will update the form configuration for all users. The version will be incremented from {version} to {version + 1}.
            </p>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3">
              <Button
                variant="outline"
                onClick={() => setShowPublishConfirm(false)}
                disabled={saving}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="w-full sm:w-auto"
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
