import { useState } from 'react';

export const GovPortalPage = () => {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<{
    idNumber: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    zipCode: string;
    file: File | null;
  }>({
    idNumber: '',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    file: null,
  });

  const handleNext = () => {
    if (step < 4) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleChange = <K extends keyof Omit<typeof formData, 'file'>>(
    field: K,
    value: typeof formData[K]
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFormData(prev => ({ ...prev, file: e.target.files[0] }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In a real implementation, this would submit the form data
    console.log('Form submitted:', formData);
    alert('Form submitted successfully!');
  };

  const renderStepContent = () => {
    switch (step) {
      case 1:
        return (
          <>
            <h2>Personal Information</h2>
            <div className="form-group">
              <label htmlFor="id-number">ID Number</label>
              <input
                type="text"
                id="id-number"
                value={formData.idNumber}
                onChange={(e) => handleChange('idNumber', e.target.value)}
                required
                maxLength="9"
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label htmlFor="first-name">First Name</label>
              <input
                type="text"
                id="first-name"
                value={formData.firstName}
                onChange={(e) => handleChange('firstName', e.target.value)}
                required
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label htmlFor="last-name">Last Name</label>
              <input
                type="text"
                id="last-name"
                value={formData.lastName}
                onChange={(e) => handleChange('lastName', e.target.value)}
                required
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label htmlFor="dob">Date of Birth</label>
              <input
                type="date"
                id="dob"
                value={formData.dateOfBirth}
                onChange={(e) => handleChange('dateOfBirth', e.target.value)}
                required
                className="form-control"
              />
            </div>
          </>
        );
      case 2:
        return (
          <>
            <h2>Address Information</h2>
            <div className="form-group">
              <label htmlFor="address-line-1">Address Line 1</label>
              <input
                type="text"
                id="address-line-1"
                value={formData.addressLine1}
                onChange={(e) => handleChange('addressLine1', e.target.value)}
                required
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label htmlFor="address-line-2">Address Line 2 (Optional)</label>
              <input
                type="text"
                id="address-line-2"
                value={formData.addressLine2}
                onChange={(e) => handleChange('addressLine2', e.target.value)}
                className="form-control"
              />
            </div>
            <div className="row">
              <div className="col-4">
                <div className="form-group">
                  <label htmlFor="city">City</label>
                  <input
                    type="text"
                    id="city"
                    value={formData.city}
                    onChange={(e) => handleChange('city', e.target.value)}
                    required
                    className="form-control"
                  />
                </div>
              </div>
              <div className="col-4">
                <div className="form-group">
                  <label htmlFor="state">State</label>
                  <input
                    type="text"
                    id="state"
                    value={formData.state}
                    onChange={(e) => handleChange('state', e.target.value)}
                    required
                    maxLength="2"
                    className="form-control"
                  />
                </div>
              </div>
              <div className="col-4">
                <div className="form-group">
                  <label htmlFor="zip">ZIP Code</label>
                  <input
                    type="text"
                    id="zip"
                    value={formData.zipCode}
                    onChange={(e) => handleChange('zipCode', e.target.value)}
                    required
                    maxLength="5"
                    className="form-control"
                  />
                </div>
              </div>
            </div>
          </>
        );
      case 3:
        return (
          <>
            <h2>Document Upload</h2>
            <p className="text-muted">
              Please upload a supporting document (PDF, JPG, or PNG, max 5MB)
            </p>
            <div className="upload-area border p-3 text-center mb-3">
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileChange}
                className="d-none"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="btn btn-outline-primary">
                Choose File
              </label>
              {formData.file && (
                <div className="mt-2">
                  <p>
                    Selected: {formData.file.name} ({Math.round(formData.file.size / 1024)} KB)
                  </p>
                </div>
              )}
            </div>
          </>
        );
      case 4:
        return (
          <>
            <h2>Review and Submit</h2>
            <div className="mb-3">
              <h3>Personal Information</h3>
              <p><strong>ID Number:</strong> {formData.idNumber}</p>
              <p><strong>Name:</strong> {formData.firstName} {formData.lastName}</p>
              <p><strong>Date of Birth:</strong> {formData.dateOfBirth}</p>
            </div>
            <div className="mb-3">
              <h3>Address Information</h3>
              <p><strong>Address:</strong> {formData.addressLine1}</p>
              {formData.addressLine2 && (
                <p>{formData.addressLine2}</p>
              )}
              <p><strong>City, State ZIP:</strong> {formData.city}, {formData.state} {formData.zipCode}</p>
            </div>
            <div className="mb-3">
              <h3>Document Upload</h3>
              {formData.file ? (
                <>
                  <p><strong>File:</strong> {formData.file.name}</p>
                  <p><strong>Size:</strong> {Math.round(formData.file.size / 1024)} KB</p>
                  <p><strong>Type:</strong> {formData.file.type}</p>
                </>
              ) : (
                <p className="text-muted">No file uploaded</p>
              )}
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="container py-4">
      <div className="row justify-content-center">
        <div className="col-md-8">
          <div className="card shadow-sm">
            <div className="card-header">
              <h1 className="h3 mb-0 text-center">Government Services Portal</h1>
            </div>
            <div className="card-body">
              <form noValidate onSubmit={handleSubmit}>
                {renderStepContent()}

                <div className="d-flex justify-content-between mt-4">
                  {step > 1 && (
                    <button type="button" className="btn btn-outline-secondary" onClick={handleBack}>
                      Back
                    </button>
                  )}
                  {step < 4 ? (
                    <button type="button" className="btn btn-primary" onClick={handleNext}>
                      {step === 3 ? 'Review' : 'Next'}
                    </button>
                  ) : (
                    <button type="submit" className="btn btn-success">
                      Submit Application
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};