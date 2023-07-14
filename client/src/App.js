import Uppy from '@uppy/core';
import { Dashboard } from '@uppy/react';
import AwsS3Multipart from '@uppy/aws-s3-multipart';
import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';

const uppy = new Uppy({
  meta: {},
  restrictions: {
    minNumberOfFiles: 1,
    maxNumberOfFiles: 10,
  },
  autoProceed: true,
  debug: true,
}).use(AwsS3Multipart, {
  shouldUseMultipart: true,
  limit: 5,
  companionUrl: 'http://localhost:3001'
});

function App() {
  return (
    <div className="App">
      <Dashboard uppy={uppy} />
    </div>
  );
}

export default App;