import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { AlertTriangle, Loader, XCircle } from "lucide-react";
import NavBar from "../components/NavBar";

function Failure() {
    const param = useParams();
    const orderId = param.orderId;
    const navigate = useNavigate();
    const [checking, setChecking] = useState(true);
    const [orderExists, setOrderExists] = useState(false);
    const token = localStorage.getItem("token");

    const checkOrderStatus = async () => {
        try {
            // Check if order exists and its current status
            const response = await axios.get(
                `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/getOrder`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            const order = response.data.find((o: any) => o._id === orderId);

            if (order) {
                setOrderExists(true);

                // If order exists and is Pending, it means payment might have failed
                // But if localhost, ESewa couldn't reach us - offer manual verification
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    // Dev mode: auto-redirect to success since ESewa can't callback to localhost
                    setTimeout(() => {
                        navigate(`/success/${orderId}`);
                    }, 3000);
                } else {
                    // In production, actually cancel the order
                    await axios.put(
                        `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/updateOrder/${orderId}`,
                        { status: "Cancelled" },
                        {
                            headers: {
                                Authorization: `Bearer ${token}`,
                                "Content-Type": "application/json",
                            },
                        }
                    );
                }
            }
        } catch (error) {
            console.error("Error checking order:", error);
        } finally {
            setChecking(false);
        }
    };

    useEffect(() => {
        if (orderId && token) {
            checkOrderStatus();
        } else {
            setChecking(false);
        }
    }, [orderId]);

    if (checking) {
        return (
            <>
                <NavBar />
                <div className="flex flex-col min-h-screen items-center justify-center bg-paper">
                    <Loader className="w-10 h-10 text-brass animate-spin mb-4" />
                    <p className="text-ink-muted">Verifying order status...</p>
                </div>
            </>
        );
    }

    // Show different message for localhost
    if (orderExists && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        return (
            <>
                <NavBar />
                <div className="flex flex-col min-h-screen">
                    <main className="flex-grow flex items-center justify-center relative bg-paper px-4">
                        <div className="relative z-10 text-center px-8 py-10 bg-paper-raised border border-hairline border-t-4 border-t-brass max-w-md w-full">
                            {/* Warning Icon */}
                            <div className="mx-auto w-20 h-20 rounded-full border-2 border-brass flex items-center justify-center mb-6">
                                <AlertTriangle className="w-10 h-10 text-brass" strokeWidth={2} />
                            </div>
                            <h1 className="text-3xl font-bold mb-4 text-ink">
                                Development Mode
                            </h1>
                            <p className="text-ink-muted text-base mb-4">
                                Your order was created successfully, but ESewa cannot reach localhost URLs.
                            </p>
                            <p className="text-ink-muted text-sm mb-6">
                                Redirecting to success page in 3 seconds...
                            </p>
                            <div className="space-y-3">
                                <Link to={`/success/${orderId}`}>
                                    <button className="w-full bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold px-6 py-2">
                                        Go to Success Page Now
                                    </button>
                                </Link>
                                <Link to="/">
                                    <button className="w-full border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold px-6 py-2">
                                        Back to Home
                                    </button>
                                </Link>
                            </div>
                            <p className="text-xs text-ink-muted mt-4">
                                Tip: Use ngrok or deploy to test ESewa properly
                            </p>
                        </div>
                    </main>
                </div>
            </>
        );
    }

  return (
    <div className="flex flex-col min-h-screen">
      <NavBar />
      <main className="flex-grow flex items-center justify-center relative bg-paper px-4">
        <div className="relative z-10 text-center px-8 py-10 bg-paper-raised border border-hairline max-w-md w-full">
          {/* Error Icon */}
          <div className="mx-auto w-20 h-20 rounded-full border-2 border-seal flex items-center justify-center mb-6">
            <XCircle className="w-11 h-11 text-seal" strokeWidth={2} />
          </div>
          <h1 className="text-4xl font-bold mb-4 text-seal">
            Payment Failed
          </h1>
          <p className="text-ink-muted text-lg mb-6">
            Unfortunately, your payment could not be processed. The order has been cancelled.
          </p>
          <div className="space-y-3">
            <Link to="/">
              <button className="w-full bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold px-6 py-2">
                Back to Home
              </button>
            </Link>
            <Link to="/my-orders">
              <button className="w-full border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold px-6 py-2">
                View My Orders
              </button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Failure;
