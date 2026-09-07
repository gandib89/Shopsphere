import { v4 as uuidv4 } from 'uuid';
import { authFetch } from './session';
import { getBackendOrigin } from './utils';

type ESewaCheckout = {
  transactionUuid: string;
  signature: string;
  signedFieldNames: string;
  productCode: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  formActionUrl: string;
};

const errorMessage = async (response: Response) => {
  try {
    const body = await response.json();
    return body.message || `Could not start payment (${response.status})`;
  } catch {
    return `Could not start payment (${response.status})`;
  }
};

export const startESewaCheckout = async (orderId: string) => {
  const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/payment/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': uuidv4(),
    },
    body: JSON.stringify({ orderId }),
  });

  if (!response.ok) throw new Error(await errorMessage(response));
  const checkout = await response.json() as ESewaCheckout;
  const backendBase = getBackendOrigin();
  const form = document.createElement('form');
  form.action = checkout.formActionUrl;
  form.method = 'POST';

  const fields = {
    amount: checkout.amount.toString(),
    tax_amount: checkout.taxAmount.toString(),
    product_service_charge: '0',
    product_delivery_charge: '0',
    total_amount: checkout.totalAmount.toString(),
    transaction_uuid: checkout.transactionUuid,
    product_code: checkout.productCode,
    success_url: `${backendBase}/api/v1/payment/esewa/success/${orderId}`,
    failure_url: `${backendBase}/api/v1/payment/esewa/failure/${orderId}`,
    signed_field_names: checkout.signedFieldNames,
    signature: checkout.signature,
  };

  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
  form.remove();
};
