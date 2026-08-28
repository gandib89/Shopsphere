import React, { useState, useEffect } from "react";
import { Mail, Lock, User, ArrowRight, Store } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { login, register } from "../lib/session";

function Auth() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to landing page
    navigate('/auth-landing');
  }, [navigate]);
  const [isSignIn, setIsSignIn] = useState(true);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    phone: "",
    role: "user",
    shopName: "",
    shopDescription: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const user = await login(formData.email, formData.password);
      toast.success("Successfully Logged In!");
      setTimeout(() => {
        if (user.admin) {
          window.location.hash = "/admin";
        } else if (user.seller) {
          window.location.hash = "/seller-panel";
        } else {
          window.location.hash = "/";
        }
      }, 2000);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        toast.error(err.response.data?.message || "Login failed");
      } else {
        toast.error("An unexpected error occurred");
      }
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const signupData: any = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phone: formData.phone,
        password: formData.password,
        role: formData.role,
      };

      if (formData.role === "seller") {
        if (!formData.shopName) {
          toast.error("Shop name is required for sellers");
          return;
        }
        signupData.shopName = formData.shopName;
        signupData.shopDescription = formData.shopDescription;
      }

      await register(signupData);

      toast.success("Successfully Registered! Please sign in.");
      setTimeout(() => {
        setIsSignIn(true);
        setFormData({
          email: "",
          password: "",
          firstName: "",
          lastName: "",
          phone: "",
          role: "user",
          shopName: "",
          shopDescription: "",
        });
      }, 2000);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        toast.error(err.response.data?.message || "Registration failed");
      } else {
        toast.error("An unexpected error occurred");
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleRoleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({
      ...prev,
      role: e.target.value,
    }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-paper">
      <div className="max-w-md w-full">
        <div className="bg-paper-raised border border-hairline overflow-hidden">
          <div className="p-8 bg-ink text-paper border-b border-brass/40">
            <h1 className="text-3xl font-bold mb-2">
              Welcome {isSignIn ? "Back" : "to Shopsphere"}
            </h1>
            <p className="text-paper/60 text-sm">
              {isSignIn
                ? "Sign in to access your account"
                : "Create an account to get started"}
            </p>
          </div>

          <div className="p-8">
            <form
              onSubmit={isSignIn ? handleSubmit : handleSignup}
              className="space-y-4"
            >
              {!isSignIn && (
                <div>
                  <div>
                    <label className="block text-sm font-semibold text-ink mb-2">
                      First Name
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-ink-muted h-5 w-5" />
                      <input
                        type="text"
                        name="firstName"
                        value={formData.firstName}
                        onChange={handleInputChange}
                        className="pl-10 w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        placeholder="Enter your first name"
                        required
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-semibold text-ink mb-2">
                      Last Name
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-ink-muted h-5 w-5" />
                      <input
                        type="text"
                        name="lastName"
                        value={formData.lastName}
                        onChange={handleInputChange}
                        className="pl-10 w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        placeholder="Enter your last name"
                        required
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-semibold text-ink mb-2">
                      Phone
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-ink-muted h-5 w-5" />
                      <input
                        type="text"
                        name="phone"
                        value={formData.phone}
                        onChange={handleInputChange}
                        className="pl-10 w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        placeholder="Enter your phone number"
                        required
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-ink mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-ink-muted h-5 w-5" />
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="pl-10 w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                    placeholder="Enter your email here"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-ink mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-ink-muted h-5 w-5" />
                  <input
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className="pl-10 w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-semibold text-ink mb-2">
                  Select Role
                </label>
                <div className="flex items-center space-x-4">
                  <label className="flex items-center text-ink">
                    <input
                      type="radio"
                      name="role"
                      value="user"
                      checked={formData.role === "user"}
                      onChange={handleRoleChange}
                      className="mr-2 accent-brass"
                    />
                    User
                  </label>
                  <label className="flex items-center text-ink">
                    <input
                      type="radio"
                      name="role"
                      value="admin"
                      checked={formData.role === "admin"}
                      onChange={handleRoleChange}
                      className="mr-2 accent-brass"
                    />
                    Admin
                  </label>
                  <label className="flex items-center text-ink">
                    <input
                      type="radio"
                      name="role"
                      value="seller"
                      checked={formData.role === "seller"}
                      onChange={handleRoleChange}
                      className="mr-2 accent-brass"
                    />
                    Seller
                  </label>
                </div>
              </div>

              {!isSignIn && formData.role === "seller" && (
                <div>
                  <div>
                    <label className="block text-sm font-semibold text-ink mb-2">
                      Shop Name *
                    </label>
                    <div className="relative">
                      <Store className="absolute left-3 top-1/2 transform -translate-y-1/2 text-ink-muted h-5 w-5" />
                      <input
                        type="text"
                        name="shopName"
                        value={formData.shopName}
                        onChange={handleInputChange}
                        className="pl-10 w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        placeholder="Enter your shop name"
                        required
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-semibold text-ink mb-2">
                      Shop Description
                    </label>
                    <textarea
                      name="shopDescription"
                      value={formData.shopDescription}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                      placeholder="Describe your shop..."
                      rows={3}
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="w-full flex items-center justify-center px-4 py-3 text-sm font-semibold text-white bg-brass hover:bg-brass-dark active:scale-[0.97] transition"
              >
                {isSignIn ? "Sign In" : "Create Account"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-ink-muted">
              {isSignIn ? "Don't have an account?" : "Already have an account?"}{" "}
              <button
                onClick={() => setIsSignIn(!isSignIn)}
                className="font-semibold text-brass hover:text-brass-dark transition"
              >
                {isSignIn ? "Sign up" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Auth;