import Fetch from 'node-fetch';

export async function loadClasses(): Promise<string[]> {
  const res = await Fetch(
    'https://storage.googleapis.com/download.tensorflow.org/data/ImageNetLabels.txt',
  );
  if (!res.ok) {
    throw new Error('Failed to fetch imagenet classes');
  }
  const text = await res.text();
  return text.split('\n').map(line => line.trim());
}

interface TensorFlowHubModel {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
}

// All use the common image input.
export const IMAGENET_MODELS: TensorFlowHubModel[] = [
  // The first one is used when triggered from auto-import.
  {
    id: 'MOBILE-NET-V2-140',
    name: 'MobileNet V2 140 [Default]',
    url:
      'https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_140_224/classification/3/default/1',
    width: 224,
    height: 224,
  },
  {
    id: 'INCEPTION-RESNET-V2',
    name: 'Inception ResNet V2',
    url:
      'https://tfhub.dev/google/tfjs-model/imagenet/inception_resnet_v2/classification/3/default/1',
    width: 299,
    height: 299,
  },
  {
    id: 'RESNET-V2-50',
    name: 'ResNet V2 50',
    url: 'https://tfhub.dev/google/tfjs-model/imagenet/resnet_v2_50/classification/3/default/1',
    width: 224,
    height: 224,
  },
  {
    id: 'RESNET-V2-101',
    name: 'ResNet V2 101',
    url: 'https://tfhub.dev/google/tfjs-model/imagenet/resnet_v2_101/classification/3/default/1',
    width: 224,
    height: 224,
  },
];
