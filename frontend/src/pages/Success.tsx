import { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import axios from "axios";
import jsPDF from "jspdf";
import NavBar from "../components/NavBar";

interface OrderDetails {
  _id: string;
  product: {
    _id: string;
    name: string;
    price: number;
    sellerId: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      shopName: string;
      shopDescription: string;
    };
  };
  firstName: string;
  lastName: string;
  email: string;
  totalPrice: number;
  quantity: number;
  deliveryAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  deliveryDate: string;
  color?: string;
  variants?: {
    storage?: string;
    color?: string;
    ram?: string;
  };
  createdAt: string;
  adminCommission: number;
}

interface Order {
  _id: string;
  product: {
    _id: string;
    name: string;
  };
  firstName: string;
  lastName: string;
  email: string;
  totalPrice: number;
}

function Success() {
    const param = useParams();
    const orderId = param.orderId;
    const token = localStorage.getItem("token");
    const [order, setOrder] = useState<Order | null>(null);
    const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);
    const updateOrderCalledRef = useRef(false);

    const updateOrder = async () => {
        // Prevent duplicate calls (handles React StrictMode and accidental double-triggers)
        if (updateOrderCalledRef.current) {
            return;
        }
        updateOrderCalledRef.current = true;

        try {
            // Step 1: Confirm order and deduct stock after successful payment
            // This endpoint also sends the confirmation email automatically
            try {
                await axios.put(
                    `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/confirm/${orderId}`,
                    {},
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                );
                toast.success("Confirmation email has been sent to your email address");
            } catch (confirmError) {
                console.error("Failed to confirm order and deduct stock:", confirmError);
                toast.error("Failed to confirm order and process stock");
            }

            // Step 2 & 3: Fetch basic order details and detailed order info in PARALLEL
            // This is faster than fetching sequentially
            const [orderRes, detailedOrderRes] = await Promise.all([
                axios.get(
                    `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/getOrder`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                ),
                axios.get(
                    `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/details/${orderId}`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                ).catch(detailError => {
                    console.error("Error fetching order details:", detailError);
                    return null;
                })
            ]);

            // Find the specific order
            const foundOrder = orderRes.data.find((o: Order) => o._id === orderId);
            if (foundOrder) {
                setOrder(foundOrder);
            }

            // Set detailed order info if available
            if (detailedOrderRes?.data) {
                setOrderDetails(detailedOrderRes.data);
            }
        } catch (error) {
            console.error("Error updating order:", error);
        }
    };

    const generatePDFReceipt = () => {
        if (!orderDetails) {
            toast.error("Order details not available");
            return;
        }

        try {
            const doc = new jsPDF();
            const pageWidth = doc.internal.pageSize.width;
            const pageHeight = doc.internal.pageSize.height;

            // Set fonts
            doc.setFont("helvetica", "bold");

            // Header - Company/Shop Name
            doc.setFontSize(24);
            doc.setTextColor(15, 118, 110); // Primary teal
            doc.text("SHOPSPHERE", pageWidth / 2, 20, { align: "center" });

            doc.setFontSize(10);
            doc.setTextColor(100, 100, 100);
            doc.text("Your Trusted Online Marketplace", pageWidth / 2, 27, { align: "center" });

            // Receipt Title
            doc.setFontSize(18);
            doc.setTextColor(0, 0, 0);
            doc.text("PURCHASE RECEIPT", pageWidth / 2, 40, { align: "center" });

            // Line separator
            doc.setDrawColor(15, 118, 110);
            doc.setLineWidth(0.5);
            doc.line(15, 45, pageWidth - 15, 45);

            // Receipt Info
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.setTextColor(50, 50, 50);
            let yPos = 55;

            doc.text(`Receipt #: ${orderDetails._id.slice(-8).toUpperCase()}`, 15, yPos);
            doc.text(`Date: ${new Date(orderDetails.createdAt).toLocaleDateString()}`, pageWidth - 15, yPos, { align: "right" });

            yPos += 10;

            // Customer Information
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.text("CUSTOMER INFORMATION", 15, yPos);
            yPos += 7;

            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.text(`Name: ${orderDetails.firstName} ${orderDetails.lastName}`, 15, yPos);
            yPos += 6;
            doc.text(`Email: ${orderDetails.email}`, 15, yPos);
            yPos += 6;

            if (orderDetails.deliveryAddress) {
                doc.text(`Address: ${orderDetails.deliveryAddress.street || ''}`, 15, yPos);
                yPos += 6;
                doc.text(`         ${orderDetails.deliveryAddress.city || ''}, ${orderDetails.deliveryAddress.state || ''} ${orderDetails.deliveryAddress.zipCode || ''}`, 15, yPos);
                yPos += 6;
                doc.text(`         ${orderDetails.deliveryAddress.country || 'Nepal'}`, 15, yPos);
                yPos += 8;
            }

            // Seller/Shop Information
            if (orderDetails.product.sellerId) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(12);
                doc.text("SELLER INFORMATION", 15, yPos);
                yPos += 7;

                doc.setFont("helvetica", "normal");
                doc.setFontSize(10);
                const seller = orderDetails.product.sellerId;
                doc.text(`Shop Name: ${seller.shopName || `${seller.firstName} ${seller.lastName}`}`, 15, yPos);
                yPos += 6;

                if (seller.shopDescription) {
                    doc.text(`Description: ${seller.shopDescription.substring(0, 50)}...`, 15, yPos);
                    yPos += 6;
                }

                doc.text(`Contact: ${seller.email}`, 15, yPos);
                yPos += 6;
                if (seller.phone) {
                    doc.text(`Phone: ${seller.phone}`, 15, yPos);
                    yPos += 8;
                }
            }

            // Order Details Table
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.text("ORDER DETAILS", 15, yPos);
            yPos += 7;

            // Table header
            doc.setFillColor(15, 118, 110);
            doc.rect(15, yPos - 5, pageWidth - 30, 8, "F");
            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.text("Product", 17, yPos);
            doc.text("Qty", pageWidth - 80, yPos);
            doc.text("Price", pageWidth - 55, yPos);
            doc.text("Total", pageWidth - 30, yPos);
            yPos += 8;

            // Table content
            doc.setTextColor(0, 0, 0);
            doc.setFont("helvetica", "normal");
            doc.text(orderDetails.product.name, 17, yPos);
            doc.text(orderDetails.quantity.toString(), pageWidth - 80, yPos);
            doc.text(`Rs. ${orderDetails.product.price.toLocaleString()}`, pageWidth - 55, yPos);
            doc.text(`Rs. ${(orderDetails.product.price * orderDetails.quantity).toLocaleString()}`, pageWidth - 30, yPos);
            yPos += 8;

            // Variants if any
            if (orderDetails.variants) {
                doc.setFontSize(8);
                doc.setTextColor(100, 100, 100);
                let variantText = "";
                if (orderDetails.variants.color) variantText += `Color: ${orderDetails.variants.color} `;
                if (orderDetails.variants.storage) variantText += `Storage: ${orderDetails.variants.storage} `;
                if (orderDetails.variants.ram) variantText += `RAM: ${orderDetails.variants.ram}`;
                if (variantText) {
                    doc.text(variantText, 17, yPos);
                    yPos += 5;
                }
            }

            // Line
            doc.setDrawColor(200, 200, 200);
            doc.setLineWidth(0.3);
            doc.line(15, yPos, pageWidth - 15, yPos);
            yPos += 8;

            // Totals (place label and amount on the same line without overlap)
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            const labelText = "TOTAL PRICE:";
            const valueText = `Rs. ${orderDetails.totalPrice.toLocaleString()}`;
            const rightMargin = 15;
            const spacing = 6; // space between label and amount

            // Measure text widths to compute safe positions
            const valueWidth = doc.getTextWidth(valueText);
            const labelWidth = doc.getTextWidth(labelText);
            const valueX = pageWidth - rightMargin - valueWidth;
            const labelX = valueX - spacing - labelWidth;

            // Draw label in brass and amount in black
            doc.setTextColor(15, 118, 110);
            doc.text(labelText, labelX, yPos);
            doc.setTextColor(0, 0, 0);
            doc.text(valueText, valueX, yPos);
            yPos += 10;

            // Delivery Date
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            doc.text(`Expected Delivery: ${new Date(orderDetails.deliveryDate).toLocaleDateString()}`, 15, yPos);

            // Footer
            yPos = pageHeight - 30;
            doc.setDrawColor(15, 118, 110);
            doc.setLineWidth(0.5);
            doc.line(15, yPos, pageWidth - 15, yPos);

            yPos += 8;
            doc.setFont("helvetica", "italic");
            doc.setFontSize(9);
            doc.setTextColor(100, 100, 100);
            doc.text("Thank you for shopping with ShopSphere!", pageWidth / 2, yPos, { align: "center" });
            yPos += 5;
            doc.setFontSize(8);
            doc.text("For any queries, please contact us at support@shopsphere.com", pageWidth / 2, yPos, { align: "center" });

            // Save PDF
            doc.save(`ShopSphere-Receipt-${orderDetails._id.slice(-8)}.pdf`);
            toast.success("Receipt downloaded successfully!");
        } catch (error) {
            console.error("Error generating PDF:", error);
            toast.error("Failed to generate receipt");
        }
    };

    useEffect(() => {
        updateOrder();
    }, [orderId]);

  return (
    <>
      <NavBar />
      <div className="flex flex-col min-h-screen">
        {/* Main Content */}
        <main className="flex-grow flex items-center justify-center relative py-12 bg-paper overflow-hidden">

          {/* Subtle legacy background blobs, kept faint so the flat instrument
              look still reads through */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-20 left-10 w-72 h-72 bg-moss/10 rounded-full blur-xl animate-blob"></div>
            <div className="absolute top-40 right-10 w-72 h-72 bg-brass/10 rounded-full blur-xl animate-blob animation-delay-2000"></div>
            <div className="absolute bottom-20 left-1/3 w-72 h-72 bg-moss/10 rounded-full blur-xl animate-blob animation-delay-4000"></div>
          </div>

          <div className="relative z-10 w-full max-w-2xl px-4">
            {/* Success Message */}
            <div className="text-center px-8 py-10 bg-paper-raised border border-hairline mb-6">
              {/* Success Icon */}
              <div className="mx-auto w-20 h-20 rounded-full border-2 border-moss flex items-center justify-center mb-6">
                <CheckCircle2 className="w-11 h-11 text-moss" strokeWidth={2} />
              </div>
              <h1 className="text-4xl font-bold mb-4 text-moss">
                Order Successful!
              </h1>
              <p className="text-ink-muted text-lg mb-6">
                Your order was successfully confirmed. Thank you for shopping with us!
              </p>
              {order && (
                <div className="bg-paper p-6 border border-hairline mb-6 text-ink text-left">
                  <p className="mb-2"><span className="font-semibold">Order ID:</span> <span className="font-mono tabular-nums">{orderId}</span></p>
                  <p className="mb-2"><span className="font-semibold">Product:</span> {order.product.name}</p>
                  {orderDetails && orderDetails.color && (
                    <p className="mb-2"><span className="font-semibold">Color:</span> {orderDetails.color || orderDetails.variants?.color}</p>
                  )}
                  {orderDetails && orderDetails.variants?.storage && (
                    <p className="mb-2"><span className="font-semibold">Storage:</span> {orderDetails.variants.storage}</p>
                  )}
                  <p className="mb-4"><span className="font-semibold">Total Amount:</span> <span className="font-mono tabular-nums">Rs. {order.totalPrice.toLocaleString()}</span></p>

                  {/* Download Receipt Button */}
                  {orderDetails && (
                    <button
                      onClick={generatePDFReceipt}
                      className="w-full bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold px-6 py-3 flex items-center justify-center gap-2"
                    >
                      <Download className="w-5 h-5" />
                      Download Receipt (PDF)
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Back to Home Button */}
            <div className="text-center mt-6">
              <Link to="/">
                <button className="border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold px-8 py-3">
                  Back to Home
                </button>
              </Link>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}


export default Success;
