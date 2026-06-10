package main

import (
	"context"
	"os"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// initTracing, OTLP/gRPC trace exporter'ını kurar ve global TracerProvider ile
// propagator'ı ayarlar. OTEL_EXPORTER_OTLP_ENDPOINT boşsa hiçbir şey yapmaz
// (no-op): yani env değişkeni set edilmediği sürece servis davranışı bugünküyle
// birebir aynı kalır. Dönen fonksiyon, çıkışta bekleyen span'leri flush etmek
// için çağrılmalıdır.
func initTracing(ctx context.Context, serviceName string) (func(context.Context) error, error) {
	endpoint := strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"))
	if endpoint == "" {
		return func(context.Context) error { return nil }, nil
	}

	exporter, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithEndpoint(endpoint),
		otlptracegrpc.WithInsecure(),
	)
	if err != nil {
		return nil, err
	}

	res, err := resource.Merge(
		resource.Default(),
		resource.NewSchemaless(attribute.String("service.name", serviceName)),
	)
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	return tp.Shutdown, nil
}

// pubsubAttributesCarrier, Pub/Sub mesaj attribute'larını (map[string]string)
// OTel propagation TextMapCarrier'ı olarak kullanılabilir hale getirir. Böylece
// trace context'i publish ederken inject, receive ederken extract edebiliriz —
// servisler arası (asenkron) trace zincirini birleştiren parça budur.
type pubsubAttributesCarrier map[string]string

func (c pubsubAttributesCarrier) Get(key string) string { return c[key] }
func (c pubsubAttributesCarrier) Set(key, value string) { c[key] = value }
func (c pubsubAttributesCarrier) Keys() []string {
	keys := make([]string, 0, len(c))
	for k := range c {
		keys = append(keys, k)
	}
	return keys
}
