'use strict'

const { config } = require('dotenv');
config();

const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const {
  S3Client,
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  UploadPartCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
const expiresIn = 60;
let s3Client;

function rfc2047Encode(data) {
  const stringData = `${data}`;
  if (/^[\x00-\x7F]*$/.test(stringData)) {
    return stringData;
  } else {
    return `=?UTF-8?B?${Buffer.from(stringData).toString('base64')}?=`;
  }
}

function getS3Client() {
  s3Client ??= new S3Client({
    region: process.env.COMPANION_AWS_REGION,
    credentials: {
      accessKeyId: process.env.COMPANION_AWS_KEY,
      secretAccessKey: process.env.COMPANION_AWS_SECRET,
    },
  });

  return s3Client;
}

function validatePartNumber(partNumberString) {
  const partNumber = Number(partNumberString);
  return Number.isInteger(partNumber) && partNumber >= 1 && partNumber <= 10000;
}

function isValidPart(part) {
  return part && typeof part === 'object' && Number(part.PartNumber) && typeof part.ETag === 'string';
}

app.use(cors({
  origin: '*',
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  optionsSuccessStatus: 200
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }), bodyParser.json());
app.post('/s3/multipart', (req, res, next) => {
  const client = getS3Client();
  const { type, metadata, filename } = req.body;
  if (typeof filename !== 'string') {
    return res.status(400).json({ error: 's3: content filename must be a string' });
  }
  if (typeof type !== 'string') {
    return res.status(400).json({ error: 's3: content type must be a string' });
  }

  const Key = `${crypto.randomUUID()}-${filename}`;
  const command = new CreateMultipartUploadCommand({
    Bucket: process.env.COMPANION_AWS_BUCKET,
    Key,
    ContentType: type,
    Metadata: Object.fromEntries(Object.entries(metadata).map(entry => entry.map(rfc2047Encode))),
  });

  return client.send(command, (err, data) => {
    if (err) {
      next(err);
      return;
    }
    res.json({
      key: data.Key,
      uploadId: data.UploadId,
    });
  });
});
app.get('/s3/multipart/:uploadId/:partNumber', (req, res, next) => {
  const { uploadId, partNumber } = req.params;
  const { key } = req.query;

  if (!validatePartNumber(partNumber)) {
    return res.status(400).json({ error: 's3: the part number must be an integer between 1 and 10000.' });
  }
  if (typeof key !== 'string') {
    return res.status(400).json({ error: 's3: the object key must be passed as a query parameter. For example: "?key=abc.jpg"' });
  }

  return getSignedUrl(getS3Client(), new UploadPartCommand({
    Bucket: process.env.COMPANION_AWS_BUCKET,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
    Body: '',
  }), { expiresIn }).then((url) => {
    res.json({ url, expires: expiresIn });
  }, next);
});
app.get('/s3/multipart/:uploadId', (req, res, next) => {
  const client = getS3Client();
  const { uploadId } = req.params;
  const { key } = req.query;

  if (typeof key !== 'string') {
    res.status(400).json({ error: 's3: the object key must be passed as a query parameter. For example: "?key=abc.jpg"' });
    return;
  }

  const parts = [];

  function listPartsPage(startAt) {
    client.send(new ListPartsCommand({
      Bucket: process.env.COMPANION_AWS_BUCKET,
      Key: key,
      UploadId: uploadId,
      PartNumberMarker: startAt,
    })).then(({ Parts, IsTruncated, NextPartNumberMarker }) => {
      if (Parts) parts.push(...Parts);

      if (IsTruncated) {
        // Get the next page.
        listPartsPage(NextPartNumberMarker);
      } else {
        res.json(parts);
      }
    }, next);
  }
  listPartsPage();
});
app.post('/s3/multipart/:uploadId/complete', (req, res, next) => {
  const client = getS3Client();
  const { uploadId } = req.params;
  const { key } = req.query;
  const { parts } = req.body;

  if (typeof key !== 'string') {
    return res.status(400).json({ error: 's3: the object key must be passed as a query parameter. For example: "?key=abc.jpg"' });
  }
  if (!Array.isArray(parts) || !parts.every(isValidPart)) {
    return res.status(400).json({ error: 's3: `parts` must be an array of {ETag, PartNumber} objects.' });
  }

  return client.send(new CompleteMultipartUploadCommand({
    Bucket: process.env.COMPANION_AWS_BUCKET,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts,
    },
  }), (err, data) => {
    if (err) {
      next(err);
      return;
    }
    res.json({
      location: data.Location,
    });
  })
})
app.delete('/s3/multipart/:uploadId', (req, res, next) => {
  const client = getS3Client();
  const { uploadId } = req.params;
  const { key } = req.query;

  if (typeof key !== 'string') {
    return res.status(400).json({ error: 's3: the object key must be passed as a query parameter. For example: "?key=abc.jpg"' });
  }

  return client.send(new AbortMultipartUploadCommand({
    Bucket: process.env.COMPANION_AWS_BUCKET,
    Key: key,
    UploadId: uploadId,
  }), (err) => {
    if (err) {
      next(err);
      return;
    }
    res.json({});
  });
});

app.listen(3001, () => {
  console.log(`Example app listening on port ${3001}`)
});