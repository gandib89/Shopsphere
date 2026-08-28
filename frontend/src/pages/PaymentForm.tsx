import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import CryptoJS from "crypto-js";
import { v4 as uuidv4 } from "uuid";
import { useLocation, useSearchParams } from "react-router-dom";

function Payment() {
  const { state } = useLocation();
  const [transactionUuid, setTransactionUuid] = useState("");
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");
  const [searchParams] = useSearchParams();
  const amount = Number(searchParams.get("totalAmount")) || 0;
  const orderId = searchParams.get("orderId") || "";
  const taxAmount = 10;
  const serviceCharge = 0;
  const deliveryCharge = 0;
  const totalAmount = amount + taxAmount + serviceCharge + deliveryCharge;

  const signedFieldNames = "total_amount,transaction_uuid,product_code";

  useEffect(() => {
    // ✅ validate amount
    if (isNaN(amount) || amount <= 0) {
      setError("Invalid amount. Please enter a valid transaction amount.");
      return;
    }

    const uuid = uuidv4();
    setTransactionUuid(uuid);

    const message = `total_amount=${totalAmount},transaction_uuid=${uuid},product_code=EPAYTEST`;
    const hash = CryptoJS.HmacSHA256(message, "8gBm/:&EnhH.1/q");
    const hashBase64 = CryptoJS.enc.Base64.stringify(hash);
    setSignature(hashBase64);
  }, [amount, totalAmount]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-paper">
        <div className="border border-dashed border-hairline p-8 text-center max-w-md">
          <p className="text-seal font-semibold">{error}</p>
        </div>
      </div>
    );
  }

  if (!transactionUuid || !signature) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <p className="flex items-center gap-2 text-ink text-lg font-semibold">
          <Loader2 className="w-5 h-5 animate-spin text-brass" />
          Loading...
        </p>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center min-h-screen bg-paper">
      <div className="bg-paper-raised border border-hairline p-8 w-full max-w-lg">
        <h1 className="text-2xl font-semibold text-center text-ink mb-6">Payment</h1>
        <form action="https://rc-epay.esewa.com.np/api/epay/main/v2/form" method="POST">
          <input type="hidden" name="amount" value={amount} />
          <input type="hidden" name="tax_amount" value={taxAmount} />
          <input type="hidden" name="product_service_charge" value={serviceCharge} />
          <input type="hidden" name="product_delivery_charge" value={deliveryCharge} />
          <input type="hidden" name="total_amount" value={totalAmount} />
          <input type="hidden" name="transaction_uuid" value={transactionUuid} />
          <input type="hidden" name="product_code" value="EPAYTEST" />
          <input type="hidden" name="success_url" value={`${window.location.origin}/#/success/${orderId}`} />
          <input type="hidden" name="failure_url" value={`${window.location.origin}/#/failure/${orderId}`} />
          <input type="hidden" name="signed_field_names" value={signedFieldNames} />
          <input type="hidden" name="signature" value={signature} />
          <input
            type="submit"
            value="Pay with Esewa"
            className="w-full py-3 text-white bg-brass hover:bg-brass-dark active:scale-[0.97] text-lg font-semibold transition duration-150 cursor-pointer"
          />
        </form>
      </div>
    </div>
  );
}

export default Payment;